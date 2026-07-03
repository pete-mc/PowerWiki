import type { WikiPage, WikiPageSummary, WikiSummary } from "./WikiPage";

export interface WikiRepositoryClient {
  /** Creates a new (empty by default) page at the given path. */
  createPage(wikiId: string, path: string, content?: string): Promise<WikiPage>;
  /** Deletes the page at the given path and any of its sub-pages. */
  deletePage(wikiId: string, path: string): Promise<void>;
  /** Returns the direct children of parentPath (one level deep). */
  getChildPages(wikiId: string, parentPath: string): Promise<WikiPageSummary[]>;
  getPage(wikiId: string, path: string): Promise<WikiPage>;
  getWikis(): Promise<WikiSummary[]>;
  /**
   * Moves the page at path to newPath and/or repositions it within its parent.
   * Used by both the "Move page" action and drag-and-drop reordering.
   */
  movePage(wikiId: string, path: string, newPath: string, newOrder: number): Promise<WikiPage>;
  savePage(wikiId: string, page: WikiPage): Promise<WikiPage>;
}
