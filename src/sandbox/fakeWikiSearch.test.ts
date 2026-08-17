import { describe, expect, it } from "vitest";

import { searchWiki } from "../wiki/wikiSearch";
import { createFakeWikiSearchTransport } from "./fakeWikiSearch";

const PAGES = [
  { path: "/Home", content: "A sandbox home page mentioning Mermaid once." },
  { path: "/Guides/Mermaid gallery", content: "Mermaid diagrams, and more mermaid below." },
  { path: "/Release-process", content: "Nothing to see here." }
];

const request = { organizationName: "sandbox", projectName: "Sandbox", searchText: "mermaid" };

describe("createFakeWikiSearchTransport", () => {
  it("returns paths that map back to the page paths the sandbox holds", async () => {
    const outcome = await searchWiki(request, createFakeWikiSearchTransport(PAGES, { latencyMs: 0 }));
    expect(outcome.hits.map((hit) => hit.path)).toEqual(["/Home", "/Guides/Mermaid gallery"]);
  });

  // A literal hyphen in a page name is escaped as %2D in the Git path; getting
  // that wrong would make a result unclickable, in the sandbox and in production.
  it("round-trips a page name containing a hyphen", async () => {
    const outcome = await searchWiki(
      { ...request, searchText: "see here" },
      createFakeWikiSearchTransport(PAGES, { latencyMs: 0 })
    );
    expect(outcome.hits[0].path).toBe("/Release-process");
  });

  it("marks the matched run inside a snippet", async () => {
    const outcome = await searchWiki(request, createFakeWikiSearchTransport(PAGES, { latencyMs: 0 }));
    expect(outcome.hits[0].snippets[0]).toContainEqual({ text: "Mermaid", isMatch: true });
  });

  it("can answer as an organization whose index is not ready", async () => {
    const outcome = await searchWiki(
      request,
      createFakeWikiSearchTransport(PAGES, { infoCode: 2, latencyMs: 0 })
    );
    expect(outcome.status.kind).toBe("indexing");
    expect(outcome.hits).toEqual([]);
  });
});
