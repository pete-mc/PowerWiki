import type {
  WikiComment,
  WikiPageChange,
  WikiPageMeta,
  WikiPageRevision
} from "./WikiComment";
import type { WikiAttachment, WikiPage, WikiPageSummary, WikiSummary } from "./WikiPage";

export interface WikiRepositoryClient {
  /** Adds a new top-level comment to a page and returns the created comment. */
  addComment(wikiId: string, pageId: number, text: string): Promise<WikiComment>;
  /**
   * Uploads a file to the wiki's `.attachments` folder and returns its name and
   * wiki-relative path. `base64Content` is the file's bytes, base64-encoded.
   */
  createAttachment(wikiId: string, name: string, base64Content: string): Promise<WikiAttachment>;
  /** Creates a new (empty by default) page at the given path. */
  createPage(wikiId: string, path: string, content?: string): Promise<WikiPage>;
  /** Deletes the page at the given path and any of its sub-pages. */
  deletePage(wikiId: string, path: string): Promise<void>;
  /** Returns the direct children of parentPath (one level deep). */
  getChildPages(wikiId: string, parentPath: string): Promise<WikiPageSummary[]>;
  /** Raw bytes of a file in the wiki's Git repository, used by export. */
  getItemBytes(repositoryId: string, repoPath: string): Promise<ArrayBuffer>;
  getPage(wikiId: string, path: string): Promise<WikiPage>;
  /** The page's Markdown as it was at a specific commit, for history compare. */
  getPageContentAtCommit(
    repositoryId: string,
    gitItemPath: string,
    commitId: string
  ): Promise<string>;
  /** Returns the id and backing Git path for a page (for comments and history). */
  getPageMeta(wikiId: string, path: string): Promise<WikiPageMeta>;
  /** Returns the author and date of the most recent change to a page's file. */
  getPageLastChange(repositoryId: string, gitItemPath: string, branch?: string): Promise<WikiPageChange | undefined>;
  /** Commits that touched the page's file, newest first. */
  getPageRevisions(
    repositoryId: string,
    gitItemPath: string,
    branch?: string,
    top?: number
  ): Promise<WikiPageRevision[]>;
  getWikis(): Promise<WikiSummary[]>;
  /** Files under the wiki's `.attachments` folder. */
  listAttachments(
    repositoryId: string,
    mappedPath: string | undefined
  ): Promise<WikiAttachment[]>;
  /** Returns the top-level comments on a page, oldest first. */
  listComments(wikiId: string, pageId: number): Promise<WikiComment[]>;
  /**
   * Moves the page at path to newPath and/or repositions it within its parent.
   * Used by both the "Move page" action and drag-and-drop reordering.
   */
  movePage(wikiId: string, path: string, newPath: string, newOrder: number): Promise<WikiPage>;
  savePage(wikiId: string, page: WikiPage): Promise<WikiPage>;
}
