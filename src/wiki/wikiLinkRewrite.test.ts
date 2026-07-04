import { describe, expect, it } from "vitest";

import { rewriteWikiLinks } from "./wikiLinkRewrite";

describe("rewriteWikiLinks", () => {
  it("rewrites an exact-path link", () => {
    const result = rewriteWikiLinks("See [the page](/Old/Path).", "/Old/Path", "/New/Home");
    expect(result.content).toBe("See [the page](/New/Home).");
    expect(result.count).toBe(1);
  });

  it("rewrites descendant and anchor links", () => {
    const markdown = "[child](/Old/Path/Child) and [anchor](/Old/Path#section)";
    const result = rewriteWikiLinks(markdown, "/Old/Path", "/New");
    expect(result.content).toBe("[child](/New/Child) and [anchor](/New#section)");
    expect(result.count).toBe(2);
  });

  it("preserves percent-encoding style", () => {
    const result = rewriteWikiLinks("[x](/Old%20Page)", "/Old Page", "/New Name");
    expect(result.content).toBe("[x](/New%20Name)");
    expect(result.count).toBe(1);
  });

  it("leaves unrelated, partial-prefix, and external links alone", () => {
    const markdown = "[a](/Old/PathLonger) [b](/Other) [c](https://example.com/Old/Path)";
    const result = rewriteWikiLinks(markdown, "/Old/Path", "/New");
    expect(result.content).toBe(markdown);
    expect(result.count).toBe(0);
  });

  it("rewrites image references too", () => {
    const result = rewriteWikiLinks("![img](/Old/Path/pic.png)", "/Old/Path", "/New");
    expect(result.content).toBe("![img](/New/pic.png)");
    expect(result.count).toBe(1);
  });
});
