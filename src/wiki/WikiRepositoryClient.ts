import type { WikiPage, WikiPageSummary, WikiSummary } from "./WikiPage";
import type { WikiOrderMap } from "./WikiPageTree";

export interface WikiRepositoryClient {
  getOrderMap(wiki: WikiSummary): Promise<WikiOrderMap>;
  getPageList(wikiId: string): Promise<WikiPageSummary[]>;
  getPage(wikiId: string, path: string): Promise<WikiPage>;
  getWikis(): Promise<WikiSummary[]>;
  savePage(page: WikiPage): Promise<WikiPage>;
}
