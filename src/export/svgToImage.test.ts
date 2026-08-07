import { describe, expect, it } from "vitest";

import { rasterScale } from "./svgToImage";

describe("rasterScale", () => {
  it("renders ordinary diagrams at 2x for crisp print output", () => {
    expect(rasterScale(800, 600)).toBe(2);
  });

  it("backs off so a wide diagram stays inside the canvas dimension limit", () => {
    const scale = rasterScale(12000, 400);
    expect(scale).toBeLessThan(2);
    expect(12000 * scale).toBeLessThanOrEqual(8192);
  });

  it("backs off so a large diagram stays inside the canvas pixel limit", () => {
    const scale = rasterScale(6000, 5000);
    expect(6000 * scale * (5000 * scale)).toBeLessThanOrEqual(32_000_000);
  });

  it("falls back to 2x for a degenerate size", () => {
    expect(rasterScale(0, 0)).toBe(2);
  });
});
