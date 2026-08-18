// The sandbox's WikiHost: an in-memory wiki, no Azure DevOps, no sign-in.
//
// This is the third implementation of the same interface the hub and VS Code
// use (see `src/host/WikiHost.ts`), which is what lets `npm run dev:sandbox`
// exercise the real UI rather than a mock of it.

import { browserDialogs, downloadInBrowser } from "../host/browserDialogs";
import type { WikiHost, WikiHostCapabilities, WikiHostContext, WikiHostNavigation } from "../host/WikiHost";
import type { WikiSummary } from "../wiki/WikiPage";
import type { WikiRepositoryClient } from "../wiki/WikiRepositoryClient";
import { searchWiki, type SearchTransport, type WikiSearchOutcome } from "../wiki/wikiSearch";

export class SandboxWikiHost implements WikiHost {
  public readonly dialogs = browserDialogs;

  public readonly capabilities: WikiHostCapabilities = {
    comments: true,
    follow: false,
    workItems: false,
    mentions: false,
    pageTree: true,
    wikiSelector: true,
    search: true,
    permalinks: false,
    printToPdf: true
  };

  public readonly searchContent?: (searchText: string) => Promise<WikiSearchOutcome>;

  public constructor(
    public readonly context: WikiHostContext,
    public readonly wikiClient: WikiRepositoryClient,
    searchTransport: SearchTransport
  ) {
    const { organizationName = "sandbox", projectName = "Sandbox" } = context;
    this.searchContent = (searchText: string) =>
      searchWiki({ organizationName, projectName, searchText }, searchTransport);
  }

  /** No host route service outside a hub; the app falls back to the URL hash. */
  public getNavigation(): Promise<WikiHostNavigation | undefined> {
    return Promise.resolve(undefined);
  }

  /** Fixture images are ordinary same-origin URLs, so no fetch is needed. */
  public loadImageObjectUrl(url: string): Promise<string> {
    return Promise.resolve(url);
  }

  public loadImageDataUrl(url: string): Promise<string> {
    return Promise.resolve(url);
  }

  public saveExportedFile(fileName: string, blob: Blob): Promise<void> {
    return downloadInBrowser(fileName, blob);
  }

  public buildPageUrl(): string | undefined {
    return undefined;
  }

  public buildAttachmentUrl(_wiki: WikiSummary, wikiPath: string): string | undefined {
    return wikiPath;
  }
}
