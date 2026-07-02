import type { WikiPage, WikiPageSummary, WikiSummary } from "./WikiPage";

export interface WikiRepositoryClient {
  /** Returns the direct children of parentPath (one level deep). */
  getChildPages(wikiId: string, parentPath: string): Promise<WikiPageSummary[]>;
  getPage(wikiId: string, path: string): Promise<WikiPage>;
  getWikis(): Promise<WikiSummary[]>;
  savePage(wikiId: string, page: WikiPage): Promise<WikiPage>;
}
