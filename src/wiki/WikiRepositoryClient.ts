import type { WikiPage, WikiPageSummary, WikiSummary } from "./WikiPage";

export interface WikiRepositoryClient {
  getPageList(wikiId: string): Promise<WikiPageSummary[]>;
  getPage(wikiId: string, path: string): Promise<WikiPage>;
  getWikis(): Promise<WikiSummary[]>;
  savePage(page: WikiPage): Promise<WikiPage>;
}
