import { describe, expect, it } from "vitest";

import { MIN_IMAGE_SIZE, preservesAspect, resizedSize, type ResizeHandle } from "./imageResize";

const START = { width: 200, height: 100 };

describe("resizedSize", () => {
  it("grows from the south-east corner as the pointer moves out", () => {
    expect(resizedSize(START, "se", 40, 0)).toEqual({ width: 240, height: 120 });
  });

  it("grows from the north-west corner as the pointer moves the other way", () => {
    // Dragging the top-left handle left and up makes the image bigger, which is
    // the opposite sign to the bottom-right one.
    expect(resizedSize(START, "nw", -40, 0)).toEqual({ width: 240, height: 120 });
  });

  it("keeps proportions on a corner drag, following the committed axis", () => {
    // Vertical movement dominates, so height leads and width is derived.
    expect(resizedSize(START, "se", 5, 50)).toEqual({ width: 300, height: 150 });
  });

  it("resizes one axis only from an edge, so squashing stays possible", () => {
    expect(resizedSize(START, "e", 50, 999)).toEqual({ width: 250, height: 100 });
    expect(resizedSize(START, "s", 999, 25)).toEqual({ width: 200, height: 125 });
  });

  it("never shrinks below a grabbable size", () => {
    // Otherwise the handles vanish with the image and it cannot be recovered.
    const size = resizedSize(START, "se", -1000, -1000);

    expect(size.width).toBe(MIN_IMAGE_SIZE);
    expect(size.height).toBeGreaterThanOrEqual(MIN_IMAGE_SIZE);
  });

  it("rounds to whole pixels, because the size is written into Markdown", () => {
    const size = resizedSize({ width: 101, height: 33 }, "se", 7, 0);

    expect(Number.isInteger(size.width)).toBe(true);
    expect(Number.isInteger(size.height)).toBe(true);
  });

  it("survives a zero-height image without dividing by it", () => {
    expect(() => resizedSize({ width: 100, height: 0 }, "se", 10, 10)).not.toThrow();
  });
});

describe("preservesAspect", () => {
  it("is the corners", () => {
    const corners: readonly ResizeHandle[] = ["nw", "ne", "se", "sw"];
    const edges: readonly ResizeHandle[] = ["n", "e", "s", "w"];

    expect(corners.every(preservesAspect)).toBe(true);
    expect(edges.some(preservesAspect)).toBe(false);
  });
});
