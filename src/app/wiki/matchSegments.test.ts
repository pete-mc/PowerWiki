import { describe, expect, it } from "vitest";

import { splitOnMatch } from "./matchSegments";

describe("splitOnMatch", () => {
  it("returns the label untouched when there is no query", () => {
    expect(splitOnMatch("Application Assessment", "  ")).toEqual([
      { text: "Application Assessment", isMatch: false }
    ]);
  });

  it("splits around a match", () => {
    expect(splitOnMatch("Lodge Application Now", "application")).toEqual([
      { text: "Lodge ", isMatch: false },
      { text: "Application", isMatch: true },
      { text: " Now", isMatch: false }
    ]);
  });

  // The label keeps its own capitalisation; the query's casing is irrelevant.
  it("matches case-insensitively without rewriting the label", () => {
    expect(splitOnMatch("Application", "APPLICATION")).toEqual([
      { text: "Application", isMatch: true }
    ]);
  });

  it("highlights every occurrence, not just the first", () => {
    expect(splitOnMatch("App and app", "app")).toEqual([
      { text: "App", isMatch: true },
      { text: " and ", isMatch: false },
      { text: "app", isMatch: true }
    ]);
  });

  it("handles a match at the start and at the end", () => {
    expect(splitOnMatch("abc", "abc")).toEqual([{ text: "abc", isMatch: true }]);
  });

  it("returns a single plain segment when nothing matches", () => {
    expect(splitOnMatch("Lands Discovery", "zzz")).toEqual([
      { text: "Lands Discovery", isMatch: false }
    ]);
  });

  // A node can survive the filter because a descendant matched, so its own name
  // may contain nothing to highlight.
  it("leaves an ancestor's name unhighlighted", () => {
    expect(splitOnMatch("Current State", "application")).toEqual([
      { text: "Current State", isMatch: false }
    ]);
  });
});
