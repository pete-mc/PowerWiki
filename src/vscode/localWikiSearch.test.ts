import { describe, expect, it } from "vitest";

import { highlight, searchLocalWiki } from "./localWikiSearch";

const pages = [
  { path: "/Home", content: "Welcome to the wiki. Mermaid diagrams render here." },
  { path: "/Guides/Mermaid", content: "How to draw a sequence diagram." },
  { path: "/Guides/Export", content: "Exporting to Word and PDF." }
];

describe("local wiki search", () => {
  it("matches on content and page name", () => {
    const outcome = searchLocalWiki(pages, "mermaid");

    expect(outcome.total).toBe(2);
    // The page actually called "Mermaid" is nearly always the one wanted.
    expect(outcome.hits[0].path).toBe("/Guides/Mermaid");
    expect(outcome.hits[0].fileName).toBe("Mermaid");
  });

  it("requires every term to appear", () => {
    expect(searchLocalWiki(pages, "sequence diagram").total).toBe(1);
    expect(searchLocalWiki(pages, "sequence unicorn").total).toBe(0);
  });

  it("returns nothing for an empty query rather than everything", () => {
    expect(searchLocalWiki(pages, "   ").hits).toEqual([]);
  });

  it("reports the cap instead of silently truncating", () => {
    const many = Array.from({ length: 5 }, (_, index) => ({
      path: `/Page ${index}`,
      content: "needle"
    }));

    const outcome = searchLocalWiki(many, "needle", { maxResults: 2 });

    expect(outcome.hits).toHaveLength(2);
    expect(outcome.total).toBe(5);
    expect(outcome.status).toEqual({ kind: "ok", trimmed: true });
  });

  it("builds snippets around the match", () => {
    const outcome = searchLocalWiki(pages, "mermaid", { snippetRadius: 5 });
    const contentHit = outcome.hits.find((hit) => hit.path === "/Home");

    expect(contentHit?.snippets[0].some((segment) => segment.isMatch)).toBe(true);
    expect(contentHit?.snippets[0].map((segment) => segment.text).join("")).toContain("Mermaid");
  });

  // A page matched on its name alone has nothing to quote; showing nothing at
  // all reads as an empty result.
  it("falls back to the opening of a page matched only by name", () => {
    const outcome = searchLocalWiki(pages, "mermaid");
    const titleHit = outcome.hits.find((hit) => hit.path === "/Guides/Mermaid");

    expect(titleHit?.snippets[0].map((segment) => segment.text).join("")).toContain("How to draw");
  });
});

describe("highlight", () => {
  it("splits a snippet into matched and unmatched runs", () => {
    expect(highlight("a big cat", ["big"])).toEqual([
      { text: "a ", isMatch: false },
      { text: "big", isMatch: true },
      { text: " cat", isMatch: false }
    ]);
  });

  it("marks every occurrence, case-insensitively", () => {
    expect(highlight("Cat cat", ["cat"])).toEqual([
      { text: "Cat", isMatch: true },
      { text: " ", isMatch: false },
      { text: "cat", isMatch: true }
    ]);
  });

  // Segments, never markup: the text is page content and must not reach innerHTML.
  it("keeps markup in the text as literal text", () => {
    expect(highlight("<b>x</b>", ["x"])).toEqual([
      { text: "<b>", isMatch: false },
      { text: "x", isMatch: true },
      { text: "</b>", isMatch: false }
    ]);
  });
});
