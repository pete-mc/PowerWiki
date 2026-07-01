import { getClient } from "azure-devops-extension-api/Common";
import { VersionControlRecursionType } from "azure-devops-extension-api/Git";
import { WikiRestClient } from "azure-devops-extension-api/Wiki";

import type { WikiPage, WikiPageSummary, WikiSummary } from "./WikiPage";
import type { WikiRepositoryClient } from "./WikiRepositoryClient";

const pageBatchSize = 100;

export class AzureDevOpsWikiRepositoryClient implements WikiRepositoryClient {
  private readonly wikiClient = getClient(WikiRestClient);

  public constructor(private readonly projectName: string) {}

  public async getWikis(): Promise<WikiSummary[]> {
    const wikis = await this.wikiClient.getAllWikis(this.projectName);

    return wikis.map((wiki) => ({
      id: wiki.id,
      name: wiki.name,
      remoteUrl: wiki.remoteUrl
    }));
  }

  public async getPageList(wikiId: string): Promise<WikiPageSummary[]> {
    const pages: WikiPageSummary[] = [];
    let continuationToken = "";

    do {
      const pageBatch = await this.wikiClient.getPagesBatch(
        {
          continuationToken,
          pageViewsForDays: 0,
          top: pageBatchSize
        },
        this.projectName,
        wikiId
      );

      pages.push(
        ...pageBatch.map((page) => ({
          id: page.id,
          path: page.path
        }))
      );
      continuationToken = pageBatch.continuationToken ?? "";
    } while (continuationToken);

    return pages;
  }

  public async getPage(wikiId: string, path: string): Promise<WikiPage> {
    const content = await this.wikiClient.getPageText(
      this.projectName,
      wikiId,
      path,
      VersionControlRecursionType.None
    );

    return {
      content,
      path
    };
  }

  public async savePage(): Promise<WikiPage> {
    throw new Error("Editing is not implemented in the first PowerWiki slice.");
  }
}
