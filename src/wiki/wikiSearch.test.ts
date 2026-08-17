import { describe, expect, it } from "vitest";

import {
  interpretInfoCode,
  pagePathFromGitPath,
  parseHighlight,
  searchWiki,
  toOutcome
} from "./wikiSearch";

describe("interpretInfoCode", () => {
  it("treats 0 as usable results", () => {
    expect(interpretInfoCode(0)).toEqual({ kind: "ok", trimmed: false });
  });

  it("treats a trimmed result set as usable, but flagged", () => {
    expect(interpretInfoCode(8)).toEqual({ kind: "ok", trimmed: true });
  });

  // The case that makes an unindexed organization look like an empty wiki.
  it.each([1, 2, 6, 7, 9])("reports %i as indexing rather than as no results", (code) => {
    expect(interpretInfoCode(code).kind).toBe("indexing");
  });

  it.each([3, 4])("reports %i as an unsupported query", (code) => {
    expect(interpretInfoCode(code).kind).toBe("unsupported-query");
  });

  it("keeps the code when it does not recognise it", () => {
    expect(interpretInfoCode(19)).toEqual({ kind: "unknown", infoCode: 19 });
  });
});

describe("pagePathFromGitPath", () => {
  it("drops the extension and restores spaces", () => {
    expect(pagePathFromGitPath("/PowerWiki-Showcase/Mermaid-Gallery.md")).toBe(
      "/PowerWiki Showcase/Mermaid Gallery"
    );
  });

  // A literal hyphen in a title is stored as %2D; decoding order decides whether
  // it survives, so this is the case that breaks a naive replace.
  it("restores a literal hyphen without swallowing it", () => {
    expect(pagePathFromGitPath("/PW%2DRename%2D123.md")).toBe("/PW-Rename-123");
  });

  it("handles a title containing both spaces and a literal hyphen", () => {
    expect(pagePathFromGitPath("/Release-Testing-%2D-Notes.md")).toBe("/Release Testing - Notes");
  });

  it("leaves a root page alone", () => {
    expect(pagePathFromGitPath("/Home.md")).toBe("/Home");
  });
});

describe("parseHighlight", () => {
  it("splits matches from surrounding text", () => {
    expect(parseHighlight("a <highlighthit>b</highlighthit> c")).toEqual([
      { text: "a ", isMatch: false },
      { text: "b", isMatch: true },
      { text: " c", isMatch: false }
    ]);
  });

  it("returns a single plain segment when nothing is highlighted", () => {
    expect(parseHighlight("plain")).toEqual([{ text: "plain", isMatch: false }]);
  });

  // The snippet is wiki content, so markup inside it must stay inert text
  // rather than being handed to anything that would parse it as HTML.
  it("does not treat other markup in the snippet as structure", () => {
    const segments = parseHighlight("<img src=x onerror=alert(1)> <highlighthit>hit</highlighthit>");
    expect(segments[0]).toEqual({ text: "<img src=x onerror=alert(1)> ", isMatch: false });
    expect(segments[1]).toEqual({ text: "hit", isMatch: true });
  });

  it("handles adjacent highlights", () => {
    expect(parseHighlight("<highlighthit>a</highlighthit><highlighthit>b</highlighthit>")).toEqual([
      { text: "a", isMatch: true },
      { text: "b", isMatch: true }
    ]);
  });
});

describe("toOutcome", () => {
  it("maps a real response shape", () => {
    const outcome = toOutcome({
      count: 1,
      infoCode: 0,
      results: [
        {
          fileName: "Mermaid-Gallery.md",
          path: "/PowerWiki-Showcase/Mermaid-Gallery.md",
          wiki: { name: "PowerWiki.wiki" },
          project: { name: "PowerWiki" },
          hits: [{ highlights: ["a <highlighthit>mermaid</highlighthit> diagram"] }]
        }
      ]
    });
    expect(outcome.total).toBe(1);
    expect(outcome.status).toEqual({ kind: "ok", trimmed: false });
    expect(outcome.hits[0].path).toBe("/PowerWiki Showcase/Mermaid Gallery");
    expect(outcome.hits[0].snippets[0]).toContainEqual({ text: "mermaid", isMatch: true });
  });

  it("surfaces the indexing state even though the response looks empty", () => {
    const outcome = toOutcome({ count: 0, infoCode: 6, results: [] });
    expect(outcome.total).toBe(0);
    expect(outcome.status.kind).toBe("indexing");
  });

  it("tolerates a response with fields missing", () => {
    expect(toOutcome({})).toEqual({ status: { kind: "ok", trimmed: false }, total: 0, hits: [] });
  });
});

describe("searchWiki", () => {
  it("posts to the search host with paging, and encodes the route", async () => {
    let seenUrl = "";
    let seenBody: unknown;
    await searchWiki(
      { organizationName: "my org", projectName: "my project", searchText: "hello", top: 5, skip: 10 },
      async (url, body) => {
        seenUrl = url;
        seenBody = body;
        return { count: 0, infoCode: 0, results: [] };
      }
    );
    expect(seenUrl).toBe(
      "https://almsearch.dev.azure.com/my%20org/my%20project/_apis/search/wikisearchresults?api-version=7.1"
    );
    expect(seenBody).toEqual({ searchText: "hello", $skip: 10, $top: 5 });
  });
});
