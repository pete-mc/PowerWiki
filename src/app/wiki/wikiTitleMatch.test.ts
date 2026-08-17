import { describe, expect, it } from "vitest";

import { matchWikiTitles } from "./wikiTitleMatch";

const PAGES = [
  { path: "/Guides", title: "Guides" },
  { path: "/Guides/Markdown reference", title: "Markdown reference" },
  { path: "/Guides/Diagrams", title: "Diagrams" },
  { path: "/Markdown", title: "Markdown" },
  { path: "/Release process", title: "Release process" }
];

describe("matchWikiTitles", () => {
  it("returns nothing for an empty query", () => {
    expect(matchWikiTitles(PAGES, "   ")).toEqual([]);
  });

  it("puts an exact title first, then a prefix, then a substring", () => {
    expect(matchWikiTitles(PAGES, "markdown").map((match) => match.path)).toEqual([
      "/Markdown",
      "/Guides/Markdown reference"
    ]);
  });

  it("matches on the path when the title does not contain the query", () => {
    expect(matchWikiTitles(PAGES, "guides/dia").map((match) => match.path)).toEqual(["/Guides/Diagrams"]);
  });

  it("is case-insensitive", () => {
    expect(matchWikiTitles(PAGES, "RELEASE").map((match) => match.path)).toEqual(["/Release process"]);
  });

  it("splits the title so the matched run can be marked", () => {
    const [match] = matchWikiTitles(PAGES, "reference");
    expect(match.titleSegments).toEqual([
      { text: "Markdown ", isMatch: false },
      { text: "reference", isMatch: true }
    ]);
  });

  it("leaves the title unmarked when only the path matched", () => {
    const [match] = matchWikiTitles(PAGES, "/guides/dia");
    expect(match.titleSegments).toEqual([{ text: "Diagrams", isMatch: false }]);
  });

  it("caps the result count", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      path: `/Page ${index}`,
      title: `Page ${index}`
    }));
    expect(matchWikiTitles(many, "page", 5)).toHaveLength(5);
  });
});
