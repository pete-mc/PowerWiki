import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { WikiSearchOutcome } from "../../wiki/wikiSearch";
import { WikiSearchResults, clampSegments } from "./WikiSearchResults";

const PAGES = [
  { path: "/Home", title: "Home" },
  { path: "/Guides/Mermaid gallery", title: "Mermaid gallery" }
];

let container: HTMLDivElement | undefined;
let root: Root | undefined;

function render(
  query: string,
  onSearchContent?: (searchText: string) => Promise<WikiSearchOutcome>
): HTMLDivElement {
  container = document.createElement("div");
  root = createRoot(container);
  act(() => {
    root!.render(
      <WikiSearchResults onSearchContent={onSearchContent} onSelect={() => {}} pages={PAGES} query={query} />
    );
  });
  return container;
}

/** Waits out the input debounce and lets the search promise settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
  }
  root = undefined;
  container = undefined;
});

const OK_EMPTY: WikiSearchOutcome = { status: { kind: "ok", trimmed: false }, total: 0, hits: [] };

describe("WikiSearchResults", () => {
  it("shows title matches before the content search has answered", () => {
    // Never resolves: whatever renders now is what a user sees while waiting.
    const element = render("mermaid", () => new Promise<WikiSearchOutcome>(() => {}));
    expect(element.textContent).toContain("Mermaid gallery");
    expect(element.textContent).toContain("Searching…");
  });

  it("searches titles even with no content search available", () => {
    const element = render("mermaid");
    expect(element.textContent).toContain("Mermaid gallery");
    expect(element.textContent).toContain("only page titles are searched");
  });

  // The case that made this worth doing: a 200 with zero results is not the
  // same thing as "there is nothing here".
  it("explains an unbuilt index instead of reporting no results", async () => {
    const element = render("mermaid", async () => ({
      status: { kind: "indexing", message: "Search indexing has not started for this organization yet." },
      total: 0,
      hits: []
    }));
    await settle();
    expect(element.textContent).toContain("Search indexing has not started");
    expect(element.textContent).not.toContain("No page content matched");
  });

  it("reports an unsupported query with the service's reason", async () => {
    const element = render("*mermaid", async () => ({
      status: { kind: "unsupported-query", message: "Queries starting with a wildcard are not supported." },
      total: 0,
      hits: []
    }));
    await settle();
    expect(element.textContent).toContain("wildcard");
    expect(element.textContent).not.toContain("No page content matched");
  });

  it("surfaces an unrecognised status code rather than showing an empty list", async () => {
    const element = render("mermaid", async () => ({
      status: { kind: "unknown", infoCode: 42 },
      total: 0,
      hits: []
    }));
    await settle();
    expect(element.textContent).toContain("code 42");
    expect(element.textContent).not.toContain("No page content matched");
  });

  it("says so when a usable search really did match nothing", async () => {
    const element = render("nothingmatchesthis", async () => OK_EMPTY);
    await settle();
    expect(element.textContent).toContain("No page content matched");
  });

  it("flags a trimmed result set", async () => {
    const element = render("mermaid", async () => ({
      status: { kind: "ok", trimmed: true },
      total: 1000,
      hits: []
    }));
    await settle();
    expect(element.textContent).toContain("Showing the first matches only");
  });

  it("shows the error when the search request fails", async () => {
    const element = render("mermaid", async () => {
      throw new Error("Wiki search failed: 403");
    });
    await settle();
    expect(element.textContent).toContain("Wiki search failed: 403");
  });

  // "diagram" matches no page title here, so every <mark> below comes from the
  // content snippet rather than from the instant title match.
  it("marks matched runs and keeps snippet markup as text", async () => {
    const element = render("diagram", async () => ({
      status: { kind: "ok", trimmed: false },
      total: 1,
      hits: [
        {
          path: "/Guides/Diagrams",
          fileName: "Diagrams.md",
          snippets: [
            [
              { text: "<img src=x onerror=alert(1)> a mermaid ", isMatch: false },
              { text: "diagram", isMatch: true }
            ]
          ]
        }
      ]
    }));
    await settle();

    const marks = element.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("diagram");
    // The snippet is wiki content: it must reach the DOM as text, never as HTML.
    expect(element.querySelector("img")).toBeNull();
    expect(element.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("does not repeat a page that already matched by title", async () => {
    const element = render("mermaid", async () => ({
      status: { kind: "ok", trimmed: false },
      total: 1,
      hits: [{ path: "/Guides/Mermaid gallery", fileName: "Mermaid-gallery.md", snippets: [] }]
    }));
    await settle();
    expect(element.querySelectorAll(".powerwiki-search-hit")).toHaveLength(1);
    expect(element.textContent).toContain("No further matches in page content.");
  });
});

describe("clampSegments", () => {
  it("leaves a short snippet alone", () => {
    const segments = [{ text: "a ", isMatch: false }, { text: "hit", isMatch: true }];
    expect(clampSegments(segments)).toBe(segments);
  });

  // A page with a long fenced code block returns a snippet long enough to swamp
  // the result list, which is what this exists to prevent.
  it("clamps a long snippet to roughly the budget", () => {
    const segments = [
      { text: "x".repeat(400), isMatch: false },
      { text: "hit", isMatch: true },
      { text: "y".repeat(400), isMatch: false }
    ];
    const clamped = clampSegments(segments, 100);
    const length = clamped.reduce((sum, s) => sum + s.text.length, 0);
    expect(length).toBeLessThan(140);
  });

  it("keeps the match itself when clamping around it", () => {
    const clamped = clampSegments(
      [{ text: "x".repeat(400), isMatch: false }, { text: "needle", isMatch: true }],
      60
    );
    expect(clamped.some((s) => s.isMatch && s.text === "needle")).toBe(true);
  });

  it("marks elision so truncation is visible", () => {
    const clamped = clampSegments(
      [{ text: "x".repeat(400), isMatch: false }, { text: "hit", isMatch: true }],
      60
    );
    expect(clamped.map((s) => s.text).join("")).toContain("…");
  });

  it("truncates the head when the snippet has no match at all", () => {
    const clamped = clampSegments([{ text: "z".repeat(400), isMatch: false }], 50);
    expect(clamped).toHaveLength(1);
    expect(clamped[0].text.length).toBeLessThanOrEqual(51);
  });
});
