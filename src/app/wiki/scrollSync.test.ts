import { describe, expect, it } from "vitest";

import { lineForPreviewTop, previewTopForLine, type SourceLineAnchor } from "./scrollSync";

// A short document: line 1 at the top, line 10 a hundred pixels down, and a
// tall block (a diagram, say) that occupies 400px for five lines of source.
const ANCHORS: readonly SourceLineAnchor[] = [
  { line: 1, top: 0 },
  { line: 10, top: 100 },
  { line: 15, top: 500 },
];

describe("previewTopForLine", () => {
  it("lands exactly on an anchored line", () => {
    expect(previewTopForLine(ANCHORS, 10)).toBe(100);
  });

  it("interpolates between anchors, so scrolling feels continuous", () => {
    // Halfway from line 10 to line 15 is halfway from 100px to 500px.
    expect(previewTopForLine(ANCHORS, 12.5)).toBe(300);
  });

  it("pins to the last anchor past the end of the document", () => {
    expect(previewTopForLine(ANCHORS, 99)).toBe(500);
  });

  it("pins to the first anchor above the first block", () => {
    expect(previewTopForLine(ANCHORS, 0)).toBe(0);
  });

  it("gives up rather than guessing when nothing is rendered", () => {
    expect(previewTopForLine([], 5)).toBeUndefined();
  });
});

describe("lineForPreviewTop", () => {
  it("is the inverse at the anchors", () => {
    expect(lineForPreviewTop(ANCHORS, 100)).toBe(10);
    expect(lineForPreviewTop(ANCHORS, 500)).toBe(15);
  });

  it("interpolates within a tall block instead of jumping", () => {
    // A 400px block spanning 5 lines: a quarter down it is a quarter of the way
    // through those lines. Without this, scrolling a diagram would move the
    // editor in one lurch when the block finally ended.
    expect(lineForPreviewTop(ANCHORS, 200)).toBe(11.25);
  });

  it("round-trips a line through both directions", () => {
    const top = previewTopForLine(ANCHORS, 12)!;
    expect(lineForPreviewTop(ANCHORS, top)).toBeCloseTo(12, 6);
  });

  it("gives up rather than guessing when nothing is rendered", () => {
    expect(lineForPreviewTop([], 40)).toBeUndefined();
  });
});
