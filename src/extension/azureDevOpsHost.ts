import * as SDK from "azure-devops-extension-sdk";

export interface AzureDevOpsHostContext {
  readonly projectName?: string;
  readonly userDisplayName: string;
}

export async function initializeAzureDevOpsHost(): Promise<AzureDevOpsHostContext> {
  await SDK.init({ loaded: false });
  await SDK.ready();

  const webContext = SDK.getWebContext();
  const user = SDK.getUser();

  SDK.notifyLoadSucceeded();

  return {
    projectName: webContext.project?.name,
    userDisplayName: user.displayName
  };
}

