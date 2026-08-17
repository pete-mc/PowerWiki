import type {
  WikiComment,
  WikiPageChange,
  WikiPageMeta,
  WikiPageRevision
} from "../wiki/WikiComment";
import type {
  WikiAttachment,
  WikiPage,
  WikiPageSummary,
  WikiSummary
} from "../wiki/WikiPage";
import type { WikiRepositoryClient } from "../wiki/WikiRepositoryClient";

/**
 * An in-memory {@link WikiRepositoryClient} for the local sandbox.
 *
 * It exists so the whole PowerWiki UI can be driven on a laptop with no Azure
 * DevOps organization, no extension install, and no sign-in — see
 * `src/sandbox/main.tsx`. Nothing here talks to a network.
 *
 * This is deliberately a *fake* (a working in-memory implementation) rather than
 * a stack of stubs: page create/rename/move/delete and comments all mutate real
 * state, so tree behaviour, ordering, and reparenting can be exercised the way
 * the real client behaves. It is not a substitute for the end-to-end pass — it
 * cannot catch REST-contract drift, permission errors, or CDN issues, which is
 * what `npm run pw:verify` against a canary build is for.
 */
export class FakeWikiRepositoryClient implements WikiRepositoryClient {
  private readonly pages = new Map<string, StoredPage>();
  private readonly comments = new Map<number, WikiComment[]>();
  private readonly wikis: readonly WikiSummary[];
  private nextId = 1;
  private nextCommentId = 1;
  /** Artificial delay per call, so loading states are visible in the sandbox. */
  private readonly latencyMs: number;

  constructor(seed: readonly SeedPage[], options: FakeWikiOptions = {}) {
    this.latencyMs = options.latencyMs ?? 120;
    this.wikis = options.wikis ?? [
      {
        id: "sandbox-wiki",
        name: "Sandbox.wiki",
        repositoryId: "sandbox-repo",
        version: "wikiMaster"
      }
    ];

    // Seed order defines sibling order, which is what the tree renders and what
    // drag-and-drop reordering mutates.
    const byParent = new Map<string, number>();
    for (const page of seed) {
      const parent = parentPath(page.path);
      const order = byParent.get(parent) ?? 0;
      byParent.set(parent, order + 1);
      this.pages.set(page.path, {
        content: page.content,
        id: this.nextId++,
        order,
        path: page.path
      });
    }
  }

  async addComment(_wikiId: string, pageId: number, text: string): Promise<WikiComment> {
    await this.tick();
    const comment: WikiComment = {
      authorName: "Sandbox User",
      createdDate: FIXED_DATE,
      id: this.nextCommentId++,
      text
    };
    const existing = this.comments.get(pageId) ?? [];
    this.comments.set(pageId, [...existing, comment]);
    return comment;
  }

  async createAttachment(
    _wikiId: string,
    name: string,
    _base64Content: string
  ): Promise<WikiAttachment> {
    await this.tick();
    // The upload is accepted and referenced so the editor's insert-markdown path
    // is exercised, but the bytes are dropped: resolving an attachment back to an
    // image goes through the host, so an uploaded image renders broken here. That
    // is a known sandbox limit, not a bug — verify attachments end to end.
    return { name, path: `/.attachments/${name}` };
  }

  async createPage(_wikiId: string, path: string, content = ""): Promise<WikiPage> {
    await this.tick();
    if (this.pages.has(path)) {
      throw new Error(`A page already exists at ${path}.`);
    }
    const page: StoredPage = {
      content,
      id: this.nextId++,
      order: this.siblingCount(parentPath(path)),
      path
    };
    this.pages.set(path, page);
    return toWikiPage(page);
  }

  async deletePage(_wikiId: string, path: string): Promise<void> {
    await this.tick();
    // Deleting a page deletes its subtree, matching the real API.
    for (const key of [...this.pages.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) {
        this.pages.delete(key);
      }
    }
  }

  async getAllPages(_wikiId: string): Promise<WikiPageSummary[]> {
    await this.tick();
    return [...this.pages.values()]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((page) => ({
        id: page.id,
        isParentPage: this.hasChildren(page.path),
        order: page.order,
        path: page.path
      }));
  }

  async getChildPages(_wikiId: string, parentPath_: string): Promise<WikiPageSummary[]> {
    await this.tick();
    return [...this.pages.values()]
      .filter((page) => parentPath(page.path) === normalizeParent(parentPath_))
      .sort((a, b) => a.order - b.order)
      .map((page) => ({
        id: page.id,
        isParentPage: this.hasChildren(page.path),
        order: page.order,
        path: page.path
      }));
  }

  async getPage(_wikiId: string, path: string): Promise<WikiPage> {
    await this.tick();
    const page = this.pages.get(path);
    if (!page) {
      throw new Error(`Page not found: ${path}`);
    }
    return toWikiPage(page);
  }

  async getPageMeta(_wikiId: string, path: string): Promise<WikiPageMeta> {
    await this.tick();
    const page = this.pages.get(path);
    return { gitItemPath: `${path}.md`, id: page?.id };
  }

  async getPageLastChange(): Promise<WikiPageChange | undefined> {
    await this.tick();
    return { authorName: "Sandbox User", date: FIXED_DATE };
  }

  async getItemBytes(): Promise<ArrayBuffer> {
    await this.tick();
    // Export asks for attachment bytes. The sandbox drops uploaded bytes, so an
    // empty buffer is the honest answer; callers treat it as an unresolvable
    // image and fall back rather than crashing.
    return new ArrayBuffer(0);
  }

  async getPageContentAtCommit(
    _repositoryId: string,
    gitItemPath: string,
    commitId: string
  ): Promise<string> {
    await this.tick();
    const path = gitItemPath.replace(/\.md$/, "");
    const current = this.pages.get(path);
    // Only one synthetic prior revision exists, so "old" content is the current
    // content with a marker line. That is enough to exercise the diff view.
    return commitId === SYNTHETIC_COMMIT_ID
      ? `${current?.content ?? ""}\n\nEdited in the sandbox.\n`
      : (current?.content ?? "");
  }

  async getPageRevisions(): Promise<WikiPageRevision[]> {
    await this.tick();
    return [
      {
        commitId: SYNTHETIC_COMMIT_ID,
        authorName: "Sandbox User",
        date: FIXED_DATE,
        comment: "Seed the sandbox wiki",
        gitItemPath: "/Home.md"
      }
    ];
  }

  async getWikis(): Promise<WikiSummary[]> {
    await this.tick();
    return [...this.wikis];
  }

  async listComments(_wikiId: string, pageId: number): Promise<WikiComment[]> {
    await this.tick();
    return [...(this.comments.get(pageId) ?? [])];
  }

  async listAttachments(): Promise<WikiAttachment[]> {
    await this.tick();
    return [];
  }

  async movePage(
    _wikiId: string,
    path: string,
    newPath: string,
    newOrder: number
  ): Promise<WikiPage> {
    await this.tick();
    const page = this.pages.get(path);
    if (!page) {
      throw new Error(`Page not found: ${path}`);
    }
    if (newPath !== path && this.pages.has(newPath)) {
      throw new Error(`A page already exists at ${newPath}.`);
    }

    // Move the page and re-key its whole subtree, which is what makes a rename
    // of a parent behave like the real wiki.
    const moved: StoredPage[] = [];
    for (const key of [...this.pages.keys()]) {
      if (key !== path && !key.startsWith(`${path}/`)) {
        continue;
      }
      const existing = this.pages.get(key)!;
      this.pages.delete(key);
      moved.push({ ...existing, path: newPath + key.slice(path.length) });
    }
    for (const entry of moved) {
      this.pages.set(entry.path, entry);
    }

    const target = this.pages.get(newPath)!;
    target.order = newOrder;
    this.resequence(parentPath(newPath), newPath, newOrder);
    return toWikiPage(target);
  }

  async savePage(_wikiId: string, page: WikiPage): Promise<WikiPage> {
    await this.tick();
    const existing = this.pages.get(page.path);
    if (!existing) {
      throw new Error(`Page not found: ${page.path}`);
    }
    existing.content = page.content;
    return toWikiPage(existing);
  }

  private hasChildren(path: string): boolean {
    for (const key of this.pages.keys()) {
      if (parentPath(key) === path) {
        return true;
      }
    }
    return false;
  }

  private siblingCount(parent: string): number {
    let count = 0;
    for (const key of this.pages.keys()) {
      if (parentPath(key) === parent) {
        count += 1;
      }
    }
    return count;
  }

  /**
   * Renumbers a parent's children so `movedPath` sits at `newOrder` and the rest
   * keep their relative order without duplicate slots.
   */
  private resequence(parent: string, movedPath: string, newOrder: number): void {
    const siblings = [...this.pages.values()]
      .filter((page) => parentPath(page.path) === parent && page.path !== movedPath)
      .sort((a, b) => a.order - b.order);

    const moved = this.pages.get(movedPath)!;
    const clamped = Math.max(0, Math.min(newOrder, siblings.length));
    siblings.splice(clamped, 0, moved);
    siblings.forEach((page, index) => {
      page.order = index;
    });
  }

  private tick(): Promise<void> {
    return this.latencyMs > 0
      ? new Promise((resolve) => setTimeout(resolve, this.latencyMs))
      : Promise.resolve();
  }
}

export interface FakeWikiOptions {
  readonly latencyMs?: number;
  readonly wikis?: readonly WikiSummary[];
}

export interface SeedPage {
  readonly content: string;
  readonly path: string;
}

interface StoredPage {
  content: string;
  readonly id: number;
  order: number;
  readonly path: string;
}

// A fixed date keeps sandbox screenshots and any snapshot stable.
const FIXED_DATE = "2026-01-15T09:30:00Z";

// The single prior revision the sandbox pretends to have.
const SYNTHETIC_COMMIT_ID = "0".repeat(40);

function toWikiPage(page: StoredPage): WikiPage {
  return { content: page.content, id: page.id, path: page.path, version: "sandbox" };
}

function normalizeParent(path: string): string {
  return path === "" ? "/" : path;
}

function parentPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.length <= 1 ? "/" : `/${segments.slice(0, -1).join("/")}`;
}
