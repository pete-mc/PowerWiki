import { describe, expect, it } from "vitest";

import { imageTypeFromPath } from "./imageMeta";

describe("imageTypeFromPath", () => {
  it("maps supported raster extensions", () => {
    expect(imageTypeFromPath("/.attachments/a.png")).toBe("png");
    expect(imageTypeFromPath("photo.JPG")).toBe("jpg");
    expect(imageTypeFromPath("photo.jpeg")).toBe("jpg");
    expect(imageTypeFromPath("anim.gif")).toBe("gif");
    expect(imageTypeFromPath("old.bmp")).toBe("bmp");
  });

  it("ignores query strings and fragments", () => {
    expect(imageTypeFromPath("/x/a.png?download=true")).toBe("png");
  });

  it("returns null for unsupported types", () => {
    expect(imageTypeFromPath("diagram.svg")).toBeNull();
    expect(imageTypeFromPath("/no/extension")).toBeNull();
  });
});
