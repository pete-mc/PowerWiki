// The shell's header, and the one thing in it that is host-dependent.
//
// `capabilities.search` existed and nothing read it, so the "Search all pages"
// box rendered on every surface — including the work item form, where the host
// says search does not belong and where a whole-wiki result is somewhere the
// tab has no way to navigate back from.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WikiHost } from "../host/WikiHost";
import { FakeWikiRepositoryClient } from "../sandbox/FakeWikiRepositoryClient";
import { App } from "./App";

const SEED = [{ path: "/Home", content: "# Home" }];

function host(overrides: { search: boolean; linkedPages?: boolean }): WikiHost {
  return {
    capabilities: {
      comments: false,
      follow: false,
      workItems: false,
      mentions: false,
      pageTree: !overrides.linkedPages,
      linkedPages: Boolean(overrides.linkedPages),
      wikiSelector: false,
      search: overrides.search,
      permalinks: false,
      printToPdf: false,
      vsCodeHandoff: false,
    },
    context: { userDisplayName: "Tester", projectName: "PowerWiki" },
    wikiClient: new FakeWikiRepositoryClient(SEED, { latencyMs: 0 }),
    dialogs: {
      alert: vi.fn(() => Promise.resolve()),
      confirm: vi.fn(() => Promise.resolve(false)),
      prompt: vi.fn(() => Promise.resolve(undefined)),
    },
    linkedPages: overrides.linkedPages
      ? { list: () => Promise.resolve([]), add: () => Promise.resolve(), remove: () => Promise.resolve() }
      : undefined,
    getNavigation: () => Promise.resolve(undefined),
    loadImageObjectUrl: (url: string) => Promise.resolve(url),
    loadImageDataUrl: (url: string) => Promise.resolve(url),
    openExternal: () => {},
    saveExportedFile: () => Promise.resolve(),
    buildPageUrl: () => undefined,
    buildAttachmentUrl: () => undefined,
  } as unknown as WikiHost;
}

let container: HTMLDivElement | undefined;
let root: Root | undefined;

async function mount(wikiHost: WikiHost): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<App host={wikiHost} status="ready" />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  return container;
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
  }
  root = undefined;
  container?.remove();
  container = undefined;
});

describe("the header search box", () => {
  it("is offered where the host says search belongs", async () => {
    const element = await mount(host({ search: true }));

    expect(element.querySelector('[aria-label="Search all pages"]')).toBeTruthy();
  });

  it("is absent on the work item form, where the host turns search off", async () => {
    const element = await mount(host({ search: false, linkedPages: true }));

    expect(element.querySelector('[aria-label="Search all pages"]')).toBeNull();
    expect(element.textContent).not.toContain("Search all pages");
  });
});
