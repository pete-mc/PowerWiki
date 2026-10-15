// Azure DevOps' full-screen mode, which the draw.io dialog's Maximize uses to
// hide the header and navigation around the extension's iframe.

import { beforeEach, describe, expect, it, vi } from "vitest";

const getService = vi.fn();

vi.mock("azure-devops-extension-sdk", () => ({
  getService: (id: string) => getService(id),
}));

const PAGE_LAYOUT_SERVICE = "ms.vss-features.host-page-layout-service";
const LOCATION_SERVICE = "ms.vss-features.location-service";

const { AzureDevOpsWikiHost } = await import("./azureDevOpsWikiHost");

const CONTEXT = {
  organizationName: "org",
  projectName: "PowerWiki",
  projectId: "adf21ddb-12ae-4355-924a-8121484e984e",
  userDisplayName: "Test",
};

let fullScreenMode = false;
const pageLayoutService = {
  getFullScreenMode: () => Promise.resolve(fullScreenMode),
  setFullScreenMode: vi.fn((value: boolean) => {
    fullScreenMode = value;
  }),
};

beforeEach(() => {
  fullScreenMode = false;
  pageLayoutService.setFullScreenMode.mockClear();
  getService.mockReset();
  // The constructor's REST clients resolve their resource areas through the
  // location service; stubbed so those lookups settle quietly.
  getService.mockImplementation((id: string) =>
    Promise.resolve(
      id === LOCATION_SERVICE
        ? { getResourceAreaLocation: () => Promise.resolve(""), getServiceLocation: () => Promise.resolve("") }
        : id === PAGE_LAYOUT_SERVICE
          ? pageLayoutService
          : undefined
    )
  );
});

describe("Azure DevOps full-screen mode", () => {
  it("drives the host page layout service in the hub", async () => {
    const host = new AzureDevOpsWikiHost(CONTEXT, "hub");

    expect(await host.fullScreen?.isFullScreen()).toBe(false);
    await host.fullScreen?.setFullScreen(true);
    expect(pageLayoutService.setFullScreenMode).toHaveBeenCalledWith(true);
    expect(await host.fullScreen?.isFullScreen()).toBe(true);
  });

  it("is not offered on the work item form, inside the work item dialog", () => {
    const host = new AzureDevOpsWikiHost(CONTEXT, "workItem");

    expect(host.fullScreen).toBeUndefined();
  });
});
