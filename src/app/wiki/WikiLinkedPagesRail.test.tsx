// The work item form's rail, rendered.
//
// Assertions are on what a user would see and click, not on internal state:
// this rail is the entire navigation on that surface, so "the picker offered
// nothing" and "the picker is still loading" have to be distinguishable on
// screen, and the unlink button has to be reachable by its accessible name.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LinkedWikiPage } from "../../host/WikiHost";
import { WikiLinkedPagesRail } from "./WikiLinkedPagesRail";

const WIKI = "fec63798-8c2b-45b3-921a-2396ea48c13d";
const PROJECT = "adf21ddb-12ae-4355-924a-8121484e984e";

const ALL_PAGES = [
  { path: "/Home", title: "Home" },
  { path: "/Guides/Alpha", title: "Alpha" },
  { path: "/Guides/Beta", title: "Beta" },
];

function linked(path: string): LinkedWikiPage {
  return { projectId: PROJECT, wikiId: WIKI, path };
}

let container: HTMLDivElement | undefined;
let root: Root | undefined;

type Props = Parameters<typeof WikiLinkedPagesRail>[0];

function render(overrides: Partial<Props> = {}): HTMLDivElement {
  container = document.createElement("div");
  root = createRoot(container);
  const props: Props = {
    allPages: ALL_PAGES,
    loading: false,
    onAdd: () => Promise.resolve(),
    onSelect: () => {},
    onUnlink: () => Promise.resolve(),
    pages: [],
    ...overrides,
  };
  act(() => {
    root!.render(<WikiLinkedPagesRail {...props} />);
  });
  return container;
}

/** Clicks and lets any promise the handler started settle. */
async function click(element: Element | null | undefined): Promise<void> {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).click();
    await Promise.resolve();
  });
}

function byLabel(element: HTMLElement, label: string): HTMLElement | null {
  return element.querySelector(`[aria-label="${label}"]`);
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
  }
  root = undefined;
  container = undefined;
});

describe("the Add picker", () => {
  it("asks for the wiki's page list when it opens, rather than waiting for a prefetch", async () => {
    const onPickerOpened = vi.fn();
    const element = render({ onPickerOpened });

    await click(element.querySelector(".powerwiki-linked-add"));

    expect(onPickerOpened).toHaveBeenCalledTimes(1);
  });

  it("does not ask again when the picker is closed", async () => {
    const onPickerOpened = vi.fn();
    const element = render({ onPickerOpened });

    await click(element.querySelector(".powerwiki-linked-add"));
    await click(element.querySelector(".powerwiki-linked-add"));

    expect(onPickerOpened).toHaveBeenCalledTimes(1);
  });

  it("offers every page in the wiki, not just the ones already on screen", async () => {
    const element = render();

    await click(element.querySelector(".powerwiki-linked-add"));

    const offered = [...element.querySelectorAll(".powerwiki-linked-candidate")].map((page) => page.textContent);
    expect(offered).toEqual(["Home", "Alpha", "Beta"]);
  });

  it("says the list is still loading rather than claiming there are no pages", async () => {
    // The distinction that matters: an empty picker on this surface used to be
    // indistinguishable from a wiki with nothing in it.
    const element = render({ allPages: [], allPagesLoading: true });

    await click(element.querySelector(".powerwiki-linked-add"));

    expect(element.textContent).toContain("Loading the wiki’s pages…");
    expect(element.textContent).not.toContain("No matching pages.");
  });

  it("reports a failure to load the list instead of showing an empty picker", async () => {
    const element = render({ allPages: [], allPagesError: "Request failed with status 403." });

    await click(element.querySelector(".powerwiki-linked-add"));

    expect(element.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
    expect(element.textContent).toContain("403");
  });

  it("still says there are no matches when the list did arrive and nothing matched", async () => {
    const element = render({ allPages: [], allPagesLoading: false });

    await click(element.querySelector(".powerwiki-linked-add"));

    expect(element.textContent).toContain("No matching pages.");
  });

  it("leaves out pages that are already linked", async () => {
    const element = render({ pages: [linked("/Guides/Alpha")] });

    await click(element.querySelector(".powerwiki-linked-add"));

    const offered = [...element.querySelectorAll(".powerwiki-linked-candidate")].map((page) => page.textContent);
    expect(offered).toEqual(["Home", "Beta"]);
  });
});

describe("unlinking", () => {
  it("offers an unlink button named after the page", () => {
    const element = render({ pages: [linked("/Guides/Alpha")] });

    expect(byLabel(element, "Unlink Alpha from this work item")).toBeTruthy();
  });

  it("hands the whole page to the unlink handler", async () => {
    const onUnlink = vi.fn().mockResolvedValue(undefined);
    const page = linked("/Guides/Alpha");
    const element = render({ onUnlink, pages: [page] });

    await click(byLabel(element, "Unlink Alpha from this work item"));

    expect(onUnlink).toHaveBeenCalledWith(page);
  });

  it("shows why an unlink failed", async () => {
    const element = render({
      onUnlink: () => Promise.reject(new Error("That page is no longer linked to this work item.")),
      pages: [linked("/Guides/Alpha")],
    });

    await click(byLabel(element, "Unlink Alpha from this work item"));

    expect(element.querySelector('[role="alert"]')?.textContent).toContain("no longer linked");
  });

  it("says nothing when the user declines the confirmation", async () => {
    // A handler that resolves without doing anything is how "cancelled" arrives
    // here, and it must not look like an error.
    const element = render({ onUnlink: () => Promise.resolve(), pages: [linked("/Guides/Alpha")] });

    await click(byLabel(element, "Unlink Alpha from this work item"));

    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it("no longer offers the Manage links button that reopened the work item", () => {
    const element = render({ pages: [linked("/Guides/Alpha")] });

    expect(element.textContent).not.toContain("Manage links");
    expect(element.querySelector(".powerwiki-linked-manage")).toBeNull();
  });
});
