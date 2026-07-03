import { getClient } from "azure-devops-extension-api/Common";
import { VersionControlRecursionType } from "azure-devops-extension-api/Git";
import {
  WikiRestClient,
  type WikiPage as WikiApiPage,
  type WikiPageMove
} from "azure-devops-extension-api/Wiki";

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

  public async getPageTextWithVersion(
    project: string,
    wikiIdentifier: string,
    path: string
  ): Promise<{ content: string; version?: string }> {
    const response = await this.beginRequest<Response>({
      apiVersion: "5.2-preview.1",
      httpResponseType: "text/plain",
      returnRawResponse: true,
      routeTemplate: "{project}/_apis/wiki/wikis/{wikiIdentifier}/pages/{*path}",
      routeValues: { project, wikiIdentifier },
      queryParams: {
        path,
        recursionLevel: VersionControlRecursionType.None,
      },
    });

    return {
      content: await response.text(),
      version: parseETag(response.headers.get("etag")),
    };
  }

  public async savePage(
    project: string,
    wikiIdentifier: string,
    page: WikiPage
  ): Promise<WikiPage> {
    const customHeaders: Record<string, string> = {};
    if (page.version) {
      customHeaders["If-Match"] = page.version;
    }

    const response = await this.beginRequest<Response>({
      apiVersion: "5.2-preview.1",
      customHeaders,
      method: "PUT",
      returnRawResponse: true,
      routeTemplate: "{project}/_apis/wiki/wikis/{wikiIdentifier}/pages/{*path}",
      routeValues: { project, wikiIdentifier },
      queryParams: {
        path: page.path,
      },
      body: {
        content: page.content,
      },
    });
    // The pages PUT endpoint returns the WikiPage object directly as the body;
    // the new version comes back in the ETag response header (the {page, eTag}
    // WikiPageResponse wrapper is only synthesised by the SDK's own clients).
    const saved = await response.json() as WikiApiPage;

    return {
      content: saved.content ?? page.content,
      id: saved.id,
      path: saved.path ?? page.path,
      version: parseETag(response.headers.get("etag")) ?? page.version,
    };
  }

  public async createPage(
    project: string,
    wikiIdentifier: string,
    path: string,
    content: string
  ): Promise<WikiPage> {
    const response = await this.beginRequest<Response>({
      apiVersion: "5.2-preview.1",
      method: "PUT",
      returnRawResponse: true,
      routeTemplate: "{project}/_apis/wiki/wikis/{wikiIdentifier}/pages/{*path}",
      routeValues: { project, wikiIdentifier },
      queryParams: { path },
      body: { content },
    });
    const saved = await response.json() as WikiApiPage;

    return {
      content: saved.content ?? content,
      id: saved.id,
      path: saved.path ?? path,
      version: parseETag(response.headers.get("etag")),
    };
  }

  public async deletePage(
    project: string,
    wikiIdentifier: string,
    path: string
  ): Promise<void> {
    await this.beginRequest<Response>({
      apiVersion: "5.2-preview.1",
      method: "DELETE",
      returnRawResponse: true,
      routeTemplate: "{project}/_apis/wiki/wikis/{wikiIdentifier}/pages/{*path}",
      routeValues: { project, wikiIdentifier },
      queryParams: { path },
    });
  }

  public async movePage(
    project: string,
    wikiIdentifier: string,
    path: string,
    newPath: string,
    newOrder: number
  ): Promise<WikiPage> {
    const response = await this.beginRequest<Response>({
      apiVersion: "5.2-preview.1",
      method: "POST",
      returnRawResponse: true,
      routeTemplate: "{project}/_apis/wiki/wikis/{wikiIdentifier}/pageMoves",
      routeValues: { project, wikiIdentifier },
      body: { path, newPath, newOrder },
    });
    const moved = await response.json() as WikiPageMove;

    return {
      content: moved.page?.content ?? "",
      id: moved.page?.id,
      path: moved.page?.path ?? newPath,
      version: parseETag(response.headers.get("etag")),
    };
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
    const page = await this.wikiJsonClient.getPageTextWithVersion(
      this.projectName,
      wikiId,
      path
    );

    return { content: page.content, path, version: page.version };
  }

  public async savePage(wikiId: string, page: WikiPage): Promise<WikiPage> {
    return this.wikiJsonClient.savePage(this.projectName, wikiId, page);
  }

  public async createPage(wikiId: string, path: string, content = ""): Promise<WikiPage> {
    return this.wikiJsonClient.createPage(this.projectName, wikiId, path, content);
  }

  public async deletePage(wikiId: string, path: string): Promise<void> {
    return this.wikiJsonClient.deletePage(this.projectName, wikiId, path);
  }

  public async movePage(
    wikiId: string,
    path: string,
    newPath: string,
    newOrder: number
  ): Promise<WikiPage> {
    return this.wikiJsonClient.movePage(this.projectName, wikiId, path, newPath, newOrder);
  }
}

function normalizeMappedPath(mappedPath: string | undefined): string {
  if (!mappedPath || mappedPath === "$/") {
    return "/";
  }

  return mappedPath.startsWith("/") ? mappedPath : `/${mappedPath}`;
}

function parseETag(value: string | null): string | undefined {
  return value?.split(",")[0]?.trim();
}
