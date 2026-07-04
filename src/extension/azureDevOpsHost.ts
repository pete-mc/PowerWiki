import * as SDK from "azure-devops-extension-sdk";

export interface AzureDevOpsHostContext {
  readonly organizationName?: string;
  readonly organizationIsHosted?: boolean;
  readonly projectName?: string;
  /** Project GUID, used for artifact subscriptions (follow). */
  readonly projectId?: string;
  readonly userDisplayName: string;
  /** Current user's identity id, used for artifact subscriptions (follow). */
  readonly userId?: string;
  /** Full contribution id of the current hub, used to build shareable links. */
  readonly contributionId?: string;
}

export async function initializeAzureDevOpsHost(): Promise<AzureDevOpsHostContext> {
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

  return {
    organizationIsHosted: host.isHosted,
    organizationName: host.name,
    projectName: webContext.project?.name,
    projectId: webContext.project?.id,
    userDisplayName: user.displayName,
    userId: user.id,
    contributionId
  };
}
