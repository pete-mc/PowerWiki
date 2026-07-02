import * as SDK from "azure-devops-extension-sdk";

export interface AzureDevOpsHostContext {
  readonly organizationName?: string;
  readonly organizationIsHosted?: boolean;
  readonly projectName?: string;
  readonly userDisplayName: string;
}

export async function initializeAzureDevOpsHost(): Promise<AzureDevOpsHostContext> {
  await SDK.init({ loaded: false });
  await SDK.ready();

  const webContext = SDK.getWebContext();
  const host = SDK.getHost();
  const user = SDK.getUser();

  SDK.notifyLoadSucceeded();

  return {
    organizationIsHosted: host.isHosted,
    organizationName: host.name,
    projectName: webContext.project?.name,
    userDisplayName: user.displayName
  };
}
