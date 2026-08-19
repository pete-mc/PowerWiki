// The Azure DevOps hub implementation of WikiHost.
//
// Everything that needs the extension SDK lives here (plus the clients it
// composes), so that no UI module has to import it. See `WikiHost.ts` for why
// that boundary matters.

import * as SDK from "azure-devops-extension-sdk";
import {
  WorkItemTrackingServiceIds,
  type IWorkItemFormNavigationService
} from "azure-devops-extension-api/WorkItemTracking";

import { resolveWithinTimeout } from "../app/wiki/hostServiceTimeout";
import { browserDialogs, downloadInBrowser } from "./browserDialogs";
import { buildHubPageUrl } from "../app/wiki/wikiHeadingLink";
import { AzureDevOpsIdentityClient } from "../identity/AzureDevOpsIdentityClient";
import type { QueryTableResult } from "../rendering/MarkdownPreview";
import { AzureDevOpsWorkItemClient } from "../workItems/AzureDevOpsWorkItemClient";
import { fetchAttachmentDataUrl, fetchAttachmentObjectUrl } from "../wiki/attachmentImage";
import { AzureDevOpsWikiRepositoryClient } from "../wiki/AzureDevOpsWikiRepositoryClient";
import { buildGitItemUrl } from "../wiki/gitItemUrl";
import { WikiFollowClient } from "../wiki/followClient";
import { searchWiki, type WikiSearchOutcome } from "../wiki/wikiSearch";
import { azureDevOpsWikiSearchTransport } from "../wiki/wikiSearchTransport";
import type { WikiSummary } from "../wiki/WikiPage";
import type { WikiRepositoryClient } from "../wiki/WikiRepositoryClient";
import type {
  FollowProvider,
  IdentityProvider,
  LinkedPagesProvider,
  WikiHost,
  WikiHostCapabilities,
  WikiHostContext,
  WikiHostNavigation,
  WorkItemProvider
} from "./WikiHost";
import { WorkItemFormLinkedPages } from "./workItemFormLinkedPages";

/**
 * Which Azure DevOps surface this host is serving. The hub is the full wiki
 * experience; the work item form is the same UI narrowed to one item's linked
 * pages.
 */
export type AzureDevOpsSurface = "hub" | "workItem";

const HOST_NAVIGATION_SERVICE_ID = "ms.vss-features.host-navigation-service";

// A real host answers in milliseconds; this only has to be short enough that a
// stalled host degrades to hash-based navigation rather than hanging.
const HOST_NAVIGATION_TIMEOUT_MS = 3000;

export async function createAzureDevOpsWikiHost(surface: AzureDevOpsSurface = "hub"): Promise<WikiHost> {
  await SDK.init({ loaded: false });
  await SDK.ready();

  const webContext = SDK.getWebContext();
  const host = SDK.getHost();
  const user = SDK.getUser();

  let contributionId: string | undefined;
  try {
    contributionId = SDK.getContributionId();
  } catch {
    // Older host or unusual load context — shareable heading links simply fall
    // back to the default in-page anchor.
    contributionId = undefined;
  }

  SDK.notifyLoadSucceeded();

  return new AzureDevOpsWikiHost(
    {
      organizationIsHosted: host.isHosted,
      organizationName: host.name,
      projectName: webContext.project?.name,
      projectId: webContext.project?.id,
      userDisplayName: user.displayName,
      userId: user.id,
      contributionId
    },
    surface
  );
}

class AzureDevOpsWikiHost implements WikiHost {
  public readonly capabilities: WikiHostCapabilities;
  public readonly context: WikiHostContext;
  public readonly dialogs = browserDialogs;
  public readonly follow: FollowProvider;
  public readonly identity: IdentityProvider;
  public readonly wikiClient: WikiRepositoryClient;
  public readonly workItems?: WorkItemProvider;
  public readonly linkedPages?: LinkedPagesProvider;
  public readonly searchContent?: (searchText: string) => Promise<WikiSearchOutcome>;

  public constructor(context: WikiHostContext, surface: AzureDevOpsSurface = "hub") {
    this.context = context;
    const onWorkItem = surface === "workItem";
    this.capabilities = {
      comments: true,
      follow: true,
      workItems: Boolean(context.projectName),
      mentions: true,
      // On a work item the rail lists that item's linked pages instead of the
      // whole wiki: the tree is the wrong navigation when the wiki is being
      // read in the context of one work item, and there is far less room.
      pageTree: !onWorkItem,
      linkedPages: onWorkItem,
      // The wiki a page belongs to is a property of each link, so there is
      // nothing for a picker to choose between.
      wikiSelector: !onWorkItem,
      search: !onWorkItem && Boolean(context.organizationName && context.projectName),
      permalinks: true,
      printToPdf: true,
      // Handing the wiki over to VS Code belongs to the full hub, not to a tab
      // inside a work item.
      vsCodeHandoff: !onWorkItem
    };

    // The hub always has a project; the type says otherwise only because the
    // SDK's web context does. Falling back to an empty name would produce
    // requests that 404, so fail loudly instead.
    if (!context.projectName) {
      throw new Error("PowerWiki needs an Azure DevOps project context.");
    }

    this.wikiClient = new AzureDevOpsWikiRepositoryClient(context.projectName);
    this.follow = new WikiFollowClient();
    this.identity = new AzureDevOpsIdentityClient();
    this.workItems = new AzureDevOpsHostWorkItems(context);

    if (onWorkItem && context.projectId) {
      this.linkedPages = new WorkItemFormLinkedPages(context.projectId);
    }

    // Content search runs against the Azure DevOps Search service, which indexes
    // the same wikis the built-in search covers — the alternative, downloading
    // every page and searching in the browser, costs one request per page and
    // does not scale.
    const { organizationName, projectName } = context;
    if (organizationName && projectName) {
      this.searchContent = (searchText: string) =>
        searchWiki({ organizationName, projectName, searchText }, azureDevOpsWikiSearchTransport);
    }
  }

  /**
   * `SDK.getService()` only *rejects* on an explicit failure. If the host
   * handshake never completes the promise simply never settles, and this call is
   * on the critical path to loading the wiki — an unbounded await would show a
   * permanent "Loading wiki." with no error and no way out, even though the
   * caller already knows how to fall back to `window.location.hash`. Time out so
   * that fallback is actually reachable.
   */
  public getNavigation(): Promise<WikiHostNavigation | undefined> {
    return resolveWithinTimeout(
      SDK.getService<WikiHostNavigation>(HOST_NAVIGATION_SERVICE_ID),
      HOST_NAVIGATION_TIMEOUT_MS
    );
  }

  public loadImageObjectUrl(url: string): Promise<string> {
    return fetchAttachmentObjectUrl(url);
  }

  public loadImageDataUrl(url: string): Promise<string> {
    return fetchAttachmentDataUrl(url);
  }

  public openExternal(url: string): void {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  public saveExportedFile(fileName: string, blob: Blob): Promise<void> {
    return downloadInBrowser(fileName, blob);
  }

  public buildPageUrl(pageHash: string, anchor?: string): string | undefined {
    return buildHubPageUrl(this.context, pageHash, anchor);
  }

  public buildAttachmentUrl(wiki: WikiSummary, wikiPath: string): string | undefined {
    const { projectName } = this.context;
    return projectName ? buildGitItemUrl(wiki, projectName, wikiPath) : undefined;
  }
}

class AzureDevOpsHostWorkItems implements WorkItemProvider {
  private readonly client: AzureDevOpsWorkItemClient;

  public constructor(private readonly context: WikiHostContext) {
    this.client = new AzureDevOpsWorkItemClient(context.projectName ?? "");
  }

  public getWorkItemBadgeDetails(id: number) {
    return this.client.getWorkItemBadgeDetails(id);
  }

  public async getQueryTable(queryId: string): Promise<QueryTableResult> {
    const result = await this.client.getQueryTable(queryId);
    return { ...result, nativeUrl: this.hubUrl(`_queries/query/${encodeURIComponent(queryId)}/`) };
  }

  public async openWorkItem(id: number): Promise<void> {
    try {
      const navigationService = await SDK.getService<IWorkItemFormNavigationService>(
        WorkItemTrackingServiceIds.WorkItemFormNavigationService
      );
      await navigationService.openWorkItem(id);
    } catch {
      const workItemUrl = this.hubUrl(`_workitems/edit/${id}/`);
      if (workItemUrl) {
        window.open(workItemUrl, "_blank", "noopener,noreferrer");
      }
    }
  }

  private hubUrl(suffix: string): string | undefined {
    const { organizationName, projectName, organizationIsHosted } = this.context;
    if (!organizationName || !projectName || !organizationIsHosted) {
      return undefined;
    }

    return (
      `https://dev.azure.com/${encodeURIComponent(organizationName)}` +
      `/${encodeURIComponent(projectName)}/${suffix}`
    );
  }
}
