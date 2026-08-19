// What the extension knows about the wikis in the current window.
//
// One instance for the whole window, shared by every PowerWiki editor tab: the
// discovery scan, the repository client, and the search index are all
// per-workspace, not per-tab, and duplicating them per tab would rescan the
// disk every time a page is opened.

import * as path from "node:path";
import * as vscode from "vscode";

import { GitWikiRepositoryClient, type WikiFileWriter } from "./GitWikiRepositoryClient";
import { searchLocalWiki, type SearchablePage } from "./localWikiSearch";
import type { WikiSearchOutcome } from "../wiki/wikiSearch";
import { discoverWikis, type DiscoveredWiki } from "./wikiDiscovery";
import { relativePathToPagePath } from "./wikiPathEncoding";

export const CONFIGURATION_SECTION = "powerwiki";

/**
 * Writes that go through VS Code rather than behind its back.
 *
 * When the file is open in an editor, the change is applied as a workspace edit
 * and then saved, so it lands in the undo stack and any save participants (a
 * formatter, a git hook via the SCM API) still run. Writing with `fs` would
 * leave the open buffer stale and the user staring at a "file changed on disk"
 * conflict after using a feature that was supposed to just work.
 */
export const vsCodeFileWriter: WikiFileWriter = {
  async writeTextFile(absolutePath, contents) {
    const uri = vscode.Uri.file(absolutePath);
    const open = vscode.workspace.textDocuments.find(
      (document) => document.uri.fsPath === uri.fsPath
    );

    if (open && !open.isClosed) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(0, 0, open.lineCount, 0), contents);
      await vscode.workspace.applyEdit(edit);
      await open.save();
      return;
    }

    await vscode.workspace.fs.writeFile(uri, Buffer.from(contents, "utf8"));
  },

  async writeBinaryFile(absolutePath, contents) {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(absolutePath), contents);
  },

  async deletePath(absolutePath, options) {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(absolutePath), {
        recursive: options.recursive,
        useTrash: true
      });
    } catch (error: unknown) {
      // Deleting a page removes both `Name.md` and `Name/`, and a page normally
      // has only one of them, so a missing target is the expected case. Only
      // that case: swallowing everything would turn a permission error into a
      // delete that silently did nothing.
      if ((error as vscode.FileSystemError).code !== "FileNotFound") {
        throw error;
      }
    }
  },

  async renamePath(fromPath, toPath) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(toPath)));
    await vscode.workspace.fs.rename(vscode.Uri.file(fromPath), vscode.Uri.file(toPath), {
      overwrite: false
    });
  },

  async createDirectory(absolutePath) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(absolutePath));
  }
};

export class WikiWorkspace implements vscode.Disposable {
  private wikis: DiscoveredWiki[] = [];
  private client = new GitWikiRepositoryClient([], vsCodeFileWriter);
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];

  public readonly onDidChangeWikis = this.changed.event;

  public constructor() {
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(CONFIGURATION_SECTION)) {
          void this.refresh();
        }
      })
    );
  }

  public get repositoryClient(): GitWikiRepositoryClient {
    return this.client;
  }

  public get discovered(): readonly DiscoveredWiki[] {
    return this.wikis;
  }

  /** Rescans the workspace. Safe to call repeatedly; it replaces what it finds. */
  public async refresh(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    const explicitRoots = configuration.get<string[]>("wikiRoots", []);

    const searchRoots =
      explicitRoots.length > 0
        ? explicitRoots.map((root) => resolveConfiguredRoot(root))
        : (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);

    this.wikis = await discoverWikis(searchRoots, {
      maxDepth: configuration.get<number>("discoveryDepth", 2),
      acceptMarkdownOnly: configuration.get<boolean>("includeMarkdownFolders", false)
    });

    this.client = new GitWikiRepositoryClient(this.wikis, vsCodeFileWriter);
    this.changed.fire();
  }

  /**
   * The wiki a file belongs to, if any.
   *
   * Longest root first, so a wiki nested inside another folder that also looks
   * like one resolves to the nearer of the two.
   */
  public findWikiForFile(fsPath: string): DiscoveredWiki | undefined {
    return [...this.wikis]
      .sort((a, b) => b.rootPath.length - a.rootPath.length)
      .find((wiki) => isInside(wiki.rootPath, fsPath));
  }

  /** The page path a file represents, or undefined if it is not a wiki page. */
  public pagePathForFile(wiki: DiscoveredWiki, fsPath: string): string | undefined {
    const relative = path.relative(wiki.rootPath, fsPath);
    if (!relative || relative.startsWith("..") || !relative.toLowerCase().endsWith(".md")) {
      return undefined;
    }

    return relativePathToPagePath(relative.split(path.sep).join("/"));
  }

  public async search(wikiId: string, query: string): Promise<WikiSearchOutcome> {
    const wiki = this.wikis.find((candidate) => candidate.rootPath === wikiId);
    if (!wiki) {
      return { status: { kind: "ok", trimmed: false }, total: 0, hits: [] };
    }

    const pages = await this.readAllPages(wiki);
    return searchLocalWiki(pages, query, { wikiName: wiki.name });
  }

  public dispose(): void {
    this.changed.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  /**
   * Every page's Markdown, read fresh.
   *
   * No cache: a wiki is a few hundred small files, and a stale index that
   * silently misses the paragraph someone just wrote is a worse failure than a
   * search that takes an extra moment.
   */
  private async readAllPages(wiki: DiscoveredWiki): Promise<SearchablePage[]> {
    const summaries = await this.client.getAllPages(wiki.rootPath);
    const pages = await Promise.all(
      summaries.map(async (summary) => {
        try {
          const page = await this.client.getPage(wiki.rootPath, summary.path);
          return { path: page.path, content: page.content };
        } catch {
          return undefined;
        }
      })
    );

    return pages.filter((page): page is SearchablePage => page !== undefined);
  }
}

function resolveConfiguredRoot(configured: string): string {
  if (path.isAbsolute(configured)) {
    return configured;
  }

  const [firstFolder] = vscode.workspace.workspaceFolders ?? [];
  return firstFolder ? path.resolve(firstFolder.uri.fsPath, configured) : path.resolve(configured);
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
