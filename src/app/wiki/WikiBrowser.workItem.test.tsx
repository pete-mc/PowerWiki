// The whole browser shell, driven on the work item form surface.
//
// These are the behaviours that only exist when `capabilities.linkedPages` is
// on, and every one of them was previously only observable in a real Azure
// DevOps work item form. They are asserted through the rendered DOM and the
// calls that reach the host, because that is the boundary the surface actually
// differs at — the rest of the app is the same code the hub runs.
//
// The wiki itself is the sandbox's in-memory client, so nothing here touches a
// network; only the linked-pages provider and the dialogs are stubs.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LinkedPagesProvider, LinkedWikiPage, WikiHost } from "../../host/WikiHost";
import { FakeWikiRepositoryClient } from "../../sandbox/FakeWikiRepositoryClient";
import { WikiBrowser } from "./WikiBrowser";

const WIKI_ID = "sandbox-wiki";
const PROJECT = "adf21ddb-12ae-4355-924a-8121484e984e";

const SEED = [
  { path: "/Home", content: "# Home\n\nThe front of the wiki." },
  { path: "/Guides", content: "# Guides" },
  { path: "/Guides/Alpha", content: "# Alpha\n\nAlpha page body." },
  { path: "/Guides/Beta", content: "# Beta\n\nBeta page body." },
];

function linked(path: string): LinkedWikiPage {
  return { projectId: PROJECT, wikiId: WIKI_ID, path };
}

interface Harness {
  readonly host: WikiHost;
  readonly linkedPages: LinkedPagesProvider & {
    list: ReturnType<typeof vi.fn>;
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  readonly confirm: ReturnType<typeof vi.fn>;
}

function harness(options: { links?: readonly LinkedWikiPage[]; confirms?: boolean } = {}): Harness {
  const links = [...(options.links ?? [])];
  const linkedPages = {
    list: vi.fn(() => Promise.resolve(links as readonly LinkedWikiPage[])),
    add: vi.fn((page: { wikiId: string; path: string }) => {
      links.push(linked(page.path));
      return Promise.resolve();
    }),
    remove: vi.fn((page: { path: string }) => {
      const index = links.findIndex((link) => link.path === page.path);
      if (index >= 0) {
        links.splice(index, 1);
      }
      return Promise.resolve();
    }),
  };
  const confirm = vi.fn(() => Promise.resolve(options.confirms ?? true));

  const host = {
    capabilities: {
      comments: false,
      follow: false,
      workItems: false,
      mentions: false,
      pageTree: false,
      linkedPages: true,
      wikiSelector: false,
      search: false,
      permalinks: false,
      printToPdf: false,
      vsCodeHandoff: false,
    },
    context: { userDisplayName: "Tester", projectName: "PowerWiki", projectId: PROJECT },
    wikiClient: new FakeWikiRepositoryClient(SEED, { latencyMs: 0 }),
    dialogs: {
      alert: vi.fn(() => Promise.resolve()),
      confirm,
      prompt: vi.fn(() => Promise.resolve(undefined)),
    },
    linkedPages,
    getNavigation: () => Promise.resolve(undefined),
    loadImageObjectUrl: (url: string) => Promise.resolve(url),
    loadImageDataUrl: (url: string) => Promise.resolve(url),
    openExternal: () => {},
    saveExportedFile: () => Promise.resolve(),
    buildPageUrl: () => undefined,
    buildAttachmentUrl: () => undefined,
  } as unknown as WikiHost;

  return { host, linkedPages, confirm };
}

let container: HTMLDivElement | undefined;
let root: Root | undefined;

/**
 * Mounts and lets the initial wiki/page load settle.
 *
 * Deliberately well under the 1.5s background prefetch delay: everything the
 * work item rail needs has to be there without waiting for it.
 */
async function mount(host: WikiHost): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<WikiBrowser host={host} />);
  });
  await settle();
  return container;
}

async function settle(ms = 120): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function click(element: Element | null | undefined): Promise<void> {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).click();
    await Promise.resolve();
  });
  await settle(20);
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
  }
  root = undefined;
  container?.remove();
  container = undefined;
});

describe("landing with nothing linked", () => {
  it("explains how to link a page instead of falling back to the wiki home page", async () => {
    const element = await mount(harness().host);

    expect(element.textContent).toContain("No wiki page is linked to this work item yet");
    expect(element.textContent).toContain("save the work item");
    // The old behaviour: the wiki's front page, presented as if it were this
    // work item's documentation.
    expect(element.textContent).not.toContain("The front of the wiki.");
  });

  it("still opens the work item's first linked page when there is one", async () => {
    const element = await mount(harness({ links: [linked("/Guides/Alpha")] }).host);

    expect(element.textContent).toContain("Alpha page body.");
    expect(element.textContent).not.toContain("No wiki page is linked to this work item yet");
  });
});

describe("the Add picker", () => {
  it("offers pages the tree has never expanded, without waiting for the background prefetch", async () => {
    const element = await mount(harness().host);

    await click(element.querySelector(".powerwiki-linked-add"));

    const offered = [...element.querySelectorAll(".powerwiki-linked-candidate")].map((page) => page.textContent);
    // "/Guides/Alpha" and "/Guides/Beta" are children of a node nothing has
    // expanded: before this, the picker showed the root pages alone until the
    // 1.5s prefetch landed, with nothing on screen to say it was incomplete.
    expect(offered).toEqual(expect.arrayContaining(["Home", "Guides", "Alpha", "Beta"]));
  });

  it("links the chosen page through the host and opens it", async () => {
    const { host, linkedPages } = harness();
    const element = await mount(host);

    await click(element.querySelector(".powerwiki-linked-add"));
    const beta = [...element.querySelectorAll<HTMLElement>(".powerwiki-linked-candidate")].find(
      (page) => page.textContent === "Beta"
    );
    await click(beta);
    await settle();

    expect(linkedPages.add).toHaveBeenCalledWith({ wikiId: WIKI_ID, path: "/Guides/Beta" });
    expect(element.textContent).toContain("Beta page body.");
  });
});

describe("unlinking a page", () => {
  it("confirms with copy that names the page and says when the change lands", async () => {
    const { host, confirm, linkedPages } = harness({ links: [linked("/Guides/Alpha")] });
    const element = await mount(host);

    await click(element.querySelector('[aria-label="Unlink Alpha from this work item"]'));

    expect(confirm).toHaveBeenCalledTimes(1);
    const message = String(confirm.mock.calls[0][0]);
    expect(message).toContain("Alpha");
    expect(message).toContain("save the work item");
    expect(linkedPages.remove).toHaveBeenCalledWith({ path: "/Guides/Alpha" });
  });

  it("removes nothing when the confirmation is declined", async () => {
    const { host, linkedPages } = harness({ links: [linked("/Guides/Alpha")], confirms: false });
    const element = await mount(host);

    await click(element.querySelector('[aria-label="Unlink Alpha from this work item"]'));

    expect(linkedPages.remove).not.toHaveBeenCalled();
    expect(element.textContent).toContain("Alpha page body.");
  });

  it("falls back to the placeholder when the page on screen was the last one linked", async () => {
    const { host } = harness({ links: [linked("/Guides/Alpha")] });
    const element = await mount(host);

    await click(element.querySelector('[aria-label="Unlink Alpha from this work item"]'));
    await settle();

    expect(element.textContent).not.toContain("Alpha page body.");
    expect(element.textContent).toContain("No wiki page is linked to this work item yet");
  });

  it("moves to another linked page rather than leaving an unlinked one on screen", async () => {
    const { host } = harness({ links: [linked("/Guides/Alpha"), linked("/Guides/Beta")] });
    const element = await mount(host);

    await click(element.querySelector('[aria-label="Unlink Alpha from this work item"]'));
    await settle();

    expect(element.textContent).toContain("Beta page body.");
  });

  it("uses the host's confirmation rather than window.confirm", async () => {
    // A VS Code webview iframe has no `allow-modals`, so `window.confirm`
    // returns false there without asking anyone. Reaching for it directly is
    // the mistake this asserts against.
    const windowConfirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { host, confirm } = harness({ links: [linked("/Guides/Alpha")] });
    const element = await mount(host);

    await click(element.querySelector('[aria-label="Unlink Alpha from this work item"]'));

    expect(confirm).toHaveBeenCalled();
    expect(windowConfirm).not.toHaveBeenCalled();
    windowConfirm.mockRestore();
  });
});
