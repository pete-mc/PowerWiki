import type { WikiComment, WikiPageChange, WikiPageMeta } from "./WikiComment";
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
  getPage(wikiId: string, path: string): Promise<WikiPage>;
  /** Returns the id and backing Git path for a page (for comments and history). */
  getPageMeta(wikiId: string, path: string): Promise<WikiPageMeta>;
  /** Returns the author and date of the most recent change to a page's file. */
  getPageLastChange(repositoryId: string, gitItemPath: string, branch?: string): Promise<WikiPageChange | undefined>;
  getWikis(): Promise<WikiSummary[]>;
  /** Returns the top-level comments on a page, oldest first. */
  listComments(wikiId: string, pageId: number): Promise<WikiComment[]>;
  /**
   * Moves the page at path to newPath and/or repositions it within its parent.
   * Used by both the "Move page" action and drag-and-drop reordering.
   */
  movePage(wikiId: string, path: string, newPath: string, newOrder: number): Promise<WikiPage>;
  savePage(wikiId: string, page: WikiPage): Promise<WikiPage>;
}
