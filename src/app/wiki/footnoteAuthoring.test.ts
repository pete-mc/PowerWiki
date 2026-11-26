import { describe, expect, it } from "vitest";
import { footnoteLabels, nextFootnoteLabel } from "./footnoteAuthoring";

describe("footnote authoring", () => {
  it("avoids labels already used by references and definitions", () => {
    expect(nextFootnoteLabel("First[^1].\n\n[^3]: Note\n\nUnfinished[^2]" )).toBe("4");
  });

  it("offers each existing definition once in document order", () => {
    expect(footnoteLabels("[^ref]: First\n[^other]: Second\n[^ref]: Duplicate"))
      .toEqual(["ref", "other"]);
  });

  it("does not offer examples inside fenced or indented code blocks", () => {
    expect(footnoteLabels("```md\n[^fake]: example\n```\n\n    [^also-fake]: code\n\n[^real]: Note"))
      .toEqual(["real"]);
  });

});
