import { getClient } from "azure-devops-extension-api/Common";
import { GitRestClient, VersionControlRecursionType } from "azure-devops-extension-api/Git";
import { WikiRestClient, type WikiPagesBatchRequest } from "azure-devops-extension-api/Wiki";

import type { WikiPage, WikiPageSummary, WikiSummary } from "./WikiPage";
import type { WikiOrderMap } from "./WikiPageTree";
import type { WikiRepositoryClient } from "./WikiRepositoryClient";

const pageBatchSize = 100;
const orderFileName = ".order";

export class AzureDevOpsWikiRepositoryClient implements WikiRepositoryClient {
  private readonly gitClient = getClient(GitRestClient);
  private readonly wikiClient = getClient(WikiRestClient);

  public constructor(private readonly projectName: string) {}

  public async getWikis(): Promise<WikiSummary[]> {
    const wikis = await this.wikiClient.getAllWikis(this.projectName);

    return wikis.map((wiki) => ({
      id: wiki.id,
      mappedPath: normalizeMappedPath(wiki.mappedPath),
      name: wiki.name,
      repositoryId: wiki.repositoryId,
      remoteUrl: wiki.remoteUrl
    }));
  }

  public async getOrderMap(wiki: WikiSummary): Promise<WikiOrderMap> {
    if (!wiki.repositoryId) {
      return new Map();
    }

    const mappedPath = wiki.mappedPath ?? "/";
    const items = await this.gitClient.getItems(
      wiki.repositoryId,
      this.projectName,
      mappedPath,
      VersionControlRecursionType.Full
    );
    const orderPaths = items
      .map((item) => item.path)
      .filter((path) => path.endsWith(`/${orderFileName}`) || path === `/${orderFileName}`);
    const orderEntries = await Promise.all(
      orderPaths.map(async (path) => {
        const content = await this.gitClient.getItemText(
          wiki.repositoryId as string,
          path,
          this.projectName
        );

        return [toWikiDirectoryPath(path, mappedPath), parseOrderFile(content)] as const;
      })
    );

    return new Map(orderEntries);
  }

  public async getPageList(wikiId: string): Promise<WikiPageSummary[]> {
    const pages: WikiPageSummary[] = [];
    let continuationToken: string | undefined;

    do {
      const request: WikiPagesBatchRequest = {
        pageViewsForDays: 0,
        top: pageBatchSize
      } as WikiPagesBatchRequest;

      if (continuationToken) {
        request.continuationToken = continuationToken;
      }

      const pageBatch = await this.wikiClient.getPagesBatch(
        request,
        this.projectName,
        wikiId
      );

      pages.push(
        ...pageBatch.map((page) => ({
          id: page.id,
          path: page.path
        }))
      );
      continuationToken = pageBatch.continuationToken ?? undefined;
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

function normalizeMappedPath(mappedPath: string | undefined): string {
  if (!mappedPath || mappedPath === "$/") {
    return "/";
  }

  return mappedPath.startsWith("/") ? mappedPath : `/${mappedPath}`;
}

function parseOrderFile(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function toWikiDirectoryPath(orderFilePath: string, mappedPath: string): string {
  const normalizedMappedPath = normalizeMappedPath(mappedPath);
  const gitDirectoryPath = orderFilePath.slice(0, -`/${orderFileName}`.length) || "/";
  const relativePath =
    normalizedMappedPath === "/"
      ? gitDirectoryPath
      : gitDirectoryPath.slice(normalizedMappedPath.length) || "/";

  return relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
}
