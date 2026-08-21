// Which surfaces are allowed to write the browser's URL.
//
// The host navigation service writes the *top page's* URL, not the extension
// iframe's, and Azure DevOps keeps the open work item dialog in that same URL
// (`...?workitem=601` for an item opened from a backlog or board). A hash
// written from the work item form is therefore a route change, and a route
// change dismisses the dialog the user is reading — which presented as the tab
// randomly closing the work item.
//
// Nothing in the types says any of that, and the failure is silent and remote
// from its cause, so the rule is pinned here rather than left to the comment.

import { beforeEach, describe, expect, it, vi } from "vitest";

const getService = vi.fn();

vi.mock("azure-devops-extension-sdk", () => ({
  getService: (id: string) => getService(id),
}));

const NAVIGATION_SERVICE = "ms.vss-features.host-navigation-service";
const LOCATION_SERVICE = "ms.vss-features.location-service";

const { AzureDevOpsWikiHost } = await import("./azureDevOpsWikiHost");

const CONTEXT = {
  organizationName: "org",
  projectName: "PowerWiki",
  projectId: "adf21ddb-12ae-4355-924a-8121484e984e",
  userDisplayName: "Test",
};

const navigationService = {
  getHash: () => Promise.resolve(""),
  setHash: () => Promise.resolve(),
  onHashChanged: () => {},
  setDocumentTitle: () => {},
};

beforeEach(() => {
  getService.mockReset();
  // The constructor builds several REST clients, and each one resolves its
  // resource area through the location service before anything here runs. It is
  // stubbed so those lookups settle quietly instead of surfacing as unhandled
  // rejections that have nothing to do with what is being tested.
  getService.mockImplementation((id: string) =>
    Promise.resolve(id === LOCATION_SERVICE ? { getResourceAreaLocation: () => Promise.resolve(""), getServiceLocation: () => Promise.resolve("") } : navigationService)
  );
});

/** Whether the top page's route handle was ever asked for. */
const askedForNavigation = () => getService.mock.calls.some(([id]) => id === NAVIGATION_SERVICE);

describe("the host navigation service", () => {
  it("is used in the hub, which owns the page it is rendered on", async () => {
    const host = new AzureDevOpsWikiHost(CONTEXT, "hub");

    expect(await host.getNavigation()).toBe(navigationService);
  });

  it("is declined on the work item form, whose URL belongs to the dialog", async () => {
    const host = new AzureDevOpsWikiHost(CONTEXT, "workItem");

    expect(await host.getNavigation()).toBeUndefined();
  });

  it("does not even ask the host for it there", async () => {
    const host = new AzureDevOpsWikiHost(CONTEXT, "workItem");
    await host.getNavigation();

    // Asking and discarding would still be wrong: the service is a handle to the
    // top page's route, and nothing on this surface should be holding one.
    expect(askedForNavigation()).toBe(false);
  });

  it("asks for it in the hub, so the check above cannot pass vacuously", async () => {
    const host = new AzureDevOpsWikiHost(CONTEXT, "hub");
    await host.getNavigation();

    expect(askedForNavigation()).toBe(true);
  });
});
