import { getClient } from "azure-devops-extension-api/Common";
import { VersionControlRecursionType } from "azure-devops-extension-api/Git";
import { WikiRestClient, type WikiPage as WikiApiPage } from "azure-devops-extension-api/Wiki";

import type { WikiPage, WikiPageSummary, WikiSummary } from "./WikiPage";
import type { WikiRepositoryClient } from "./WikiRepositoryClient";

interface WikiWithRepositoryFallback {
  readonly repository?: {
    readonly id?: string;
  };
}

// Subclasses WikiRestClient to expose the same pages endpoint but requesting
// JSON instead of text/plain, which returns the full WikiPage object including
// subPages, order, and isParentPage.
class WikiJsonClient extends WikiRestClient {
  public getPageJson(
    project: string,
    wikiIdentifier: string,
    path: string
  ): Promise<WikiApiPage> {
    return this.beginRequest<WikiApiPage>({
      apiVersion: "5.2-preview.1",
      routeTemplate: "{project}/_apis/wiki/wikis/{wikiIdentifier}/pages",
      routeValues: { project, wikiIdentifier },
      queryParams: {
        path,
        recursionLevel: VersionControlRecursionType.OneLevel,
        includeContent: false,
      },
    });
  }
}

export class AzureDevOpsWikiRepositoryClient implements WikiRepositoryClient {
  private readonly wikiClient = getClient(WikiRestClient);
  private readonly wikiJsonClient = getClient(WikiJsonClient);

  public constructor(private readonly projectName: string) {}

  public async getWikis(): Promise<WikiSummary[]> {
    const wikis = await this.wikiClient.getAllWikis(this.projectName);

    return wikis.map((wiki) => ({
      id: wiki.id,
      mappedPath: normalizeMappedPath(wiki.mappedPath),
      name: wiki.name,
      repositoryId: wiki.repositoryId ?? (wiki as WikiWithRepositoryFallback).repository?.id ?? wiki.id,
      remoteUrl: wiki.remoteUrl,
    }));
  }

  public async getChildPages(wikiId: string, parentPath: string): Promise<WikiPageSummary[]> {
    const page = await this.wikiJsonClient.getPageJson(this.projectName, wikiId, parentPath);

    return (page.subPages ?? []).map((subPage: WikiApiPage) => ({
      id: subPage.id,
      isParentPage: subPage.isParentPage ?? false,
      order: subPage.order ?? 0,
      path: subPage.path,
    }));
  }

  public async getPage(wikiId: string, path: string): Promise<WikiPage> {
    const content = await this.wikiClient.getPageText(
      this.projectName,
      wikiId,
      path,
      VersionControlRecursionType.None
    );

    return { content, path };
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
