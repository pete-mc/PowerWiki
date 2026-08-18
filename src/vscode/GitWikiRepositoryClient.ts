// WikiRepositoryClient over a cloned Azure DevOps wiki on disk.
//
// This is the second implementation of the interface the whole UI is written
// against (`src/wiki/WikiRepositoryClient.ts`); the first talks to the Azure
// DevOps REST API. Everything above it — the browser, the editors, rendering,
// export, draw.io — is unchanged.
//
// Two things the service does for the hub have to be done here by hand, and
// they are where the bugs live:
//
//   * **file naming.** A page path is not a file path: spaces become hyphens
//     and a set of characters is percent-encoded (see `wikiPathEncoding.ts`).
//   * **`.order`.** Page order is a file in each folder, not a field on a page.
//
// Two things are *better* off a clone than through the API, and the code says
// so where it happens: attachments are mutable (the wiki attachments API is
// create-only — see AGENTS.md), and history follows renames because Git does.

import { promises as fs } from "node:fs";
import * as path from "node:path";

import type {
  WikiComment,
  WikiPageChange,
  WikiPageMeta,
  WikiPageRevision
} from "../wiki/WikiComment";
import type { WikiAttachment, WikiPage, WikiPageSummary, WikiSummary } from "../wiki/WikiPage";
import type { WikiRepositoryClient } from "../wiki/WikiRepositoryClient";
import { logFile, showFileAtCommit } from "./git";
import {
  applyOrder,
  formatOrderFile,
  insertIntoOrder,
  parseOrderFile,
  removeFromOrder,
  type OrderedNames
} from "./orderFile";
import type { DiscoveredWiki } from "./wikiDiscovery";
import {
  normalizePagePath,
  pagePathToRelativePath,
  parentPagePath,
  relativePathToPagePath,
  splitPagePath
} from "./wikiPathEncoding";

const ORDER_FILE = ".order";
const ATTACHMENTS_DIRECTORY = ".attachments";

/**
 * How a page's Markdown reaches disk.
 *
 * The extension supplies an implementation that goes through VS Code's editor
 * stack, so a save participates in undo, dirty state, and any formatter the
 * user has configured, instead of writing behind the editor's back. Tests use
 * plain `fs`. Reads always come from disk, so an unsaved buffer is not shown as
 * page content — that would render text the repository does not contain.
 */
export interface WikiFileWriter {
  writeTextFile(absolutePath: string, contents: string): Promise<void>;
  writeBinaryFile(absolutePath: string, contents: Uint8Array): Promise<void>;
  deletePath(absolutePath: string, options: { recursive: boolean }): Promise<void>;
  renamePath(fromPath: string, toPath: string): Promise<void>;
  createDirectory(absolutePath: string): Promise<void>;
}

export const nodeFileWriter: WikiFileWriter = {
  async writeTextFile(absolutePath, contents) {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, contents, "utf8");
  },
  async writeBinaryFile(absolutePath, contents) {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, contents);
  },
  async deletePath(absolutePath, options) {
    await fs.rm(absolutePath, { force: true, recursive: options.recursive });
  },
  async renamePath(fromPath, toPath) {
    await fs.mkdir(path.dirname(toPath), { recursive: true });
    await fs.rename(fromPath, toPath);
  },
  async createDirectory(absolutePath) {
    await fs.mkdir(absolutePath, { recursive: true });
  }
};

export class GitWikiRepositoryClient implements WikiRepositoryClient {
  private readonly wikisById: ReadonlyMap<string, DiscoveredWiki>;

  public constructor(
    wikis: readonly DiscoveredWiki[],
    private readonly writer: WikiFileWriter = nodeFileWriter
  ) {
    this.wikisById = new Map(wikis.map((wiki) => [wiki.rootPath, wiki]));
  }

  // --- wikis --------------------------------------------------------------

  public getWikis(): Promise<WikiSummary[]> {
    return Promise.resolve(
      [...this.wikisById.values()].map((wiki) => ({
        id: wiki.rootPath,
        name: wiki.name,
        // Both ids are the wiki root: this host has no separate repository
        // identifier, and `mappedPath` is "/" because every path the app hands
        // back to us is already relative to the wiki, not to the enclosing repo.
        repositoryId: wiki.rootPath,
        mappedPath: "/"
      }))
    );
  }

  // --- reading pages ------------------------------------------------------

  public async getPage(wikiId: string, pagePath: string): Promise<WikiPage> {
    const root = this.rootFor(wikiId);
    const normalized = normalizePagePath(pagePath);
    const filePath = pageFilePath(root, normalized);

    try {
      const content = await fs.readFile(filePath, "utf8");
      return { content: stripBom(content), path: normalized, id: pageId(normalized) };
    } catch {
      // A folder with no `<name>.md` beside it is still a page in the built-in
      // wiki — an empty parent that exists only to hold children. Treat it the
      // same rather than reporting the page as missing.
      if (await isDirectory(pageFolderPath(root, normalized))) {
        return { content: "", path: normalized, id: pageId(normalized) };
      }

      throw new Error(`Page not found: ${normalized}`);
    }
  }

  public async getChildPages(wikiId: string, parentPath: string): Promise<WikiPageSummary[]> {
    const root = this.rootFor(wikiId);
    const normalizedParent = normalizePagePath(parentPath);
    const directory = pageFolderPath(root, normalizedParent);

    const entries = await readDirectorySafely(directory);
    if (!entries) {
      return [];
    }

    // A page can appear as `Name.md`, as a `Name/` folder, or as both; the union
    // of the two is the set of pages, and the folder is what makes it a parent.
    const stems = new Set<string>();
    const parents = new Set<string>();
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) {
          continue;
        }
        stems.add(entry.name);
        parents.add(entry.name);
      } else if (entry.name.toLowerCase().endsWith(".md")) {
        stems.add(entry.name.slice(0, -3));
      }
    }

    const order = await readOrderFile(directory);
    return applyOrder([...stems], order).map((stem, index) => {
      const childPath = joinPagePath(normalizedParent, stem);
      return {
        id: pageId(childPath),
        isParentPage: parents.has(stem),
        order: index,
        path: childPath
      };
    });
  }

  /**
   * Every page in the wiki, flattened. Cheap here — it is a directory walk with
   * no content read — which is what lets the tree filter match a page nobody
   * has opened.
   */
  public async getAllPages(wikiId: string): Promise<WikiPageSummary[]> {
    const pages: WikiPageSummary[] = [];

    const walk = async (parentPath: string): Promise<void> => {
      const children = await this.getChildPages(wikiId, parentPath);
      for (const child of children) {
        pages.push(child);
        if (child.isParentPage) {
          await walk(child.path);
        }
      }
    };

    await walk("/");
    return pages;
  }

  public async getPageMeta(wikiId: string, pagePath: string): Promise<WikiPageMeta> {
    const normalized = normalizePagePath(pagePath);
    return { id: pageId(normalized), gitItemPath: this.repositoryRelativePath(wikiId, normalized) };
  }

  // --- writing pages ------------------------------------------------------

  public async createPage(wikiId: string, pagePath: string, content = ""): Promise<WikiPage> {
    const root = this.rootFor(wikiId);
    const normalized = normalizePagePath(pagePath);
    const filePath = pageFilePath(root, normalized);

    if (await pathExists(filePath)) {
      throw new Error(`A page already exists at ${normalized}.`);
    }

    await this.writer.writeTextFile(filePath, content);
    await this.addToParentOrder(root, normalized);
    return { content, path: normalized, id: pageId(normalized) };
  }

  public async savePage(wikiId: string, page: WikiPage): Promise<WikiPage> {
    const root = this.rootFor(wikiId);
    const normalized = normalizePagePath(page.path);
    await this.writer.writeTextFile(pageFilePath(root, normalized), page.content);
    return { ...page, path: normalized, id: pageId(normalized) };
  }

  public async deletePage(wikiId: string, pagePath: string): Promise<void> {
    const root = this.rootFor(wikiId);
    const normalized = normalizePagePath(pagePath);

    // Sub-pages live in the folder, so removing it is what makes the delete
    // recursive — matching the built-in wiki, which deletes a page's children.
    await this.writer.deletePath(pageFilePath(root, normalized), { recursive: false });
    await this.writer.deletePath(pageFolderPath(root, normalized), { recursive: true });
    await this.rewriteOrder(pageFolderPath(root, parentPagePath(normalized)), (order) =>
      removeFromOrder(order, lastFileSegment(normalized))
    );
  }

  /**
   * Moves a page to `newPath` and/or repositions it among its siblings.
   *
   * Both halves matter: the tree's drag-to-reorder calls this with an unchanged
   * path and a new index, and "Move page" calls it with a new parent.
   */
  public async movePage(
    wikiId: string,
    pagePath: string,
    newPath: string,
    newOrder: number
  ): Promise<WikiPage> {
    const root = this.rootFor(wikiId);
    const from = normalizePagePath(pagePath);
    const to = normalizePagePath(newPath);

    if (from !== to) {
      if (await pathExists(pageFilePath(root, to))) {
        throw new Error(`A page already exists at ${to}.`);
      }

      if (await pathExists(pageFilePath(root, from))) {
        await this.writer.renamePath(pageFilePath(root, from), pageFilePath(root, to));
      }
      // Children move with their parent; the folder is where they live.
      if (await isDirectory(pageFolderPath(root, from))) {
        await this.writer.renamePath(pageFolderPath(root, from), pageFolderPath(root, to));
      }

      await this.rewriteOrder(pageFolderPath(root, parentPagePath(from)), (order) =>
        removeFromOrder(order, lastFileSegment(from))
      );
    }

    await this.rewriteOrder(pageFolderPath(root, parentPagePath(to)), (order) =>
      insertIntoOrder(order, lastFileSegment(to), newOrder)
    );

    const content = await readFileSafely(pageFilePath(root, to));
    return { content: content ?? "", path: to, id: pageId(to) };
  }

  // --- attachments --------------------------------------------------------

  /**
   * Stores an attachment, replacing one of the same name.
   *
   * Worth noting because it is a real difference from the hub: the wiki
   * attachments REST API is create-only, which is why `src/drawio/` writes a new
   * file per revision and repoints references. Off a clone the file is just a
   * file, so overwriting is allowed and nothing has to be repointed.
   */
  public async createAttachment(
    wikiId: string,
    name: string,
    base64Content: string
  ): Promise<WikiAttachment> {
    const root = this.rootFor(wikiId);
    const bytes = Uint8Array.from(Buffer.from(base64Content, "base64"));
    await this.writer.writeBinaryFile(path.join(root, ATTACHMENTS_DIRECTORY, name), bytes);
    return { name, path: `/${ATTACHMENTS_DIRECTORY}/${name}` };
  }

  public async listAttachments(repositoryId: string): Promise<WikiAttachment[]> {
    const root = this.rootFor(repositoryId);
    const entries = await readDirectorySafely(path.join(root, ATTACHMENTS_DIRECTORY));
    if (!entries) {
      return [];
    }

    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => ({ name: entry.name, path: `/${ATTACHMENTS_DIRECTORY}/${entry.name}` }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Raw bytes of a file under the wiki root, used by export and by images. */
  public async getItemBytes(repositoryId: string, repoPath: string): Promise<ArrayBuffer> {
    const root = this.rootFor(repositoryId);
    const buffer = await fs.readFile(resolveWithinRoot(root, repoPath));
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  }

  // --- history ------------------------------------------------------------

  public async getPageLastChange(
    repositoryId: string,
    gitItemPath: string
  ): Promise<WikiPageChange | undefined> {
    const wiki = this.wikiFor(repositoryId);
    if (!wiki.repositoryPath) {
      return undefined;
    }

    const [commit] = await logFile(wiki.repositoryPath, trimLeadingSlash(gitItemPath), 1);
    return commit ? { authorName: commit.authorName, date: commit.date } : undefined;
  }

  public async getPageRevisions(
    repositoryId: string,
    gitItemPath: string,
    _branch?: string,
    top = 50
  ): Promise<WikiPageRevision[]> {
    const wiki = this.wikiFor(repositoryId);
    if (!wiki.repositoryPath) {
      return [];
    }

    const relativePath = trimLeadingSlash(gitItemPath);
    const commits = await logFile(wiki.repositoryPath, relativePath, top);
    return commits.map((commit) => ({
      commitId: commit.commitId,
      authorName: commit.authorName,
      date: commit.date,
      comment: commit.comment,
      gitItemPath: relativePath
    }));
  }

  public async getPageContentAtCommit(
    repositoryId: string,
    gitItemPath: string,
    commitId: string
  ): Promise<string> {
    const wiki = this.wikiFor(repositoryId);
    if (!wiki.repositoryPath) {
      throw new Error("This wiki is not inside a Git repository, so earlier revisions are unavailable.");
    }

    const content = await showFileAtCommit(
      wiki.repositoryPath,
      trimLeadingSlash(gitItemPath),
      commitId
    );
    if (content === undefined) {
      throw new Error(`This page does not exist at commit ${commitId.slice(0, 8)}.`);
    }

    return content;
  }

  // --- comments -----------------------------------------------------------
  //
  // Comments are Azure DevOps service state, not files, so a clone has none and
  // `WikiHostCapabilities.comments` is false for this host. These stay honest
  // rather than pretending to an empty comment thread that could be posted to.

  public listComments(): Promise<WikiComment[]> {
    return Promise.resolve([]);
  }

  public addComment(): Promise<WikiComment> {
    return Promise.reject(new Error("Comments are stored in Azure DevOps and are not available offline."));
  }

  // --- internals ----------------------------------------------------------

  private wikiFor(wikiId: string): DiscoveredWiki {
    const wiki = this.wikisById.get(wikiId);
    if (!wiki) {
      throw new Error(`Unknown wiki: ${wikiId}`);
    }
    return wiki;
  }

  private rootFor(wikiId: string): string {
    return this.wikiFor(wikiId).rootPath;
  }

  /** A page's file path relative to the enclosing repository, for Git commands. */
  private repositoryRelativePath(wikiId: string, pagePath: string): string {
    const wiki = this.wikiFor(wikiId);
    const withinWiki = `${pagePathToRelativePath(pagePath)}.md`;
    if (!wiki.repositoryPath) {
      return withinWiki;
    }

    const absolute = path.join(wiki.rootPath, withinWiki);
    return path.relative(wiki.repositoryPath, absolute).split(path.sep).join("/");
  }

  private async addToParentOrder(root: string, pagePath: string): Promise<void> {
    const parentDirectory = pageFolderPath(root, parentPagePath(pagePath));
    const stem = lastFileSegment(pagePath);
    await this.rewriteOrder(parentDirectory, (order) =>
      insertIntoOrder(order, stem, order.listed.length)
    );
  }

  /**
   * Rewrites a folder's `.order`, but only when the folder already had one.
   *
   * A wiki whose author never reordered anything has no `.order` files, and
   * creating them on the first edit would put a file in every touched folder
   * that the built-in wiki never asked for.
   */
  private async rewriteOrder(
    directory: string,
    update: (order: OrderedNames) => string[]
  ): Promise<void> {
    const orderPath = path.join(directory, ORDER_FILE);
    if (!(await pathExists(orderPath))) {
      return;
    }

    const order = await readOrderFile(directory);
    await this.writer.writeTextFile(orderPath, formatOrderFile(update(order)));
  }
}

// --- path helpers ---------------------------------------------------------

function pageFilePath(root: string, pagePath: string): string {
  return path.join(root, `${pagePathToRelativePath(pagePath)}.md`);
}

function pageFolderPath(root: string, pagePath: string): string {
  const relative = pagePathToRelativePath(pagePath);
  return relative ? path.join(root, relative) : root;
}

/** The file-name stem a page path's last segment is stored under. */
function lastFileSegment(pagePath: string): string {
  return pagePathToRelativePath(pagePath).split("/").at(-1) ?? "";
}

function joinPagePath(parentPath: string, fileStem: string): string {
  const parentSegments = splitPagePath(parentPath);
  const pageSegment = relativePathToPagePath(fileStem).slice(1);
  return `/${[...parentSegments, pageSegment].join("/")}`;
}

/**
 * Resolves a wiki-relative path under the wiki root, refusing to escape it.
 *
 * The path comes from page Markdown, so `![](../../../../etc/passwd)` is a
 * thing an author can write. In the hub the API would simply 404; here it would
 * be a file read, so the containment check is the boundary.
 */
function resolveWithinRoot(root: string, repoPath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, trimLeadingSlash(repoPath));
  const relative = path.relative(resolvedRoot, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path is outside the wiki: ${repoPath}`);
  }

  return resolved;
}

function trimLeadingSlash(value: string): string {
  return value.replace(/^\/+/, "");
}

/**
 * A stable numeric id for a page path.
 *
 * The interface types page ids as numbers because Azure DevOps assigns them.
 * Nothing off a clone needs them to mean anything beyond "same page, same id"
 * within a session, which a hash of the path gives.
 */
function pageId(pagePath: string): number {
  let hash = 2166136261;
  for (let index = 0; index < pagePath.length; index += 1) {
    hash ^= pagePath.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

async function readOrderFile(directory: string): Promise<OrderedNames> {
  const contents = await readFileSafely(path.join(directory, ORDER_FILE));
  return parseOrderFile(contents ?? "");
}

async function readFileSafely(filePath: string): Promise<string | undefined> {
  try {
    return stripBom(await fs.readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

async function readDirectorySafely(directory: string) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return undefined;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}
