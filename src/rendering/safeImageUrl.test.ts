import { describe, expect, it } from "vitest";

import { toSafeImageUrl } from "./safeImageUrl";
import { sanitizeRenderedHtml } from "./sanitizeRenderedHtml";

const BASE = "https://dev.azure.com/org/project/";

describe("toSafeImageUrl", () => {
  it("allows the authenticated Git Items URLs the app builds", () => {
    expect(toSafeImageUrl(
        "https://dev.azure.com/org/project/_apis/git/repositories/abc/Items?path=%2F.attachments%2Fa.png",
        BASE
      )).toBeDefined();
  });

  it("allows http, for Azure DevOps Server behind plain http", () => {
    expect(toSafeImageUrl("http://tfs.internal/collection/x.png", BASE)).toBeDefined();
  });

  it("allows the object URLs the preview creates for fetched attachments", () => {
    expect(toSafeImageUrl("blob:https://dev.azure.com/9f8e-4a1b", BASE)).toBeDefined();
  });

  it("allows a relative path, which inherits the page's scheme", () => {
    expect(toSafeImageUrl("/.attachments/diagram.png", BASE)).toBeDefined();
    expect(toSafeImageUrl("image.png", BASE)).toBeDefined();
  });

  it("rejects javascript:", () => {
    expect(toSafeImageUrl("javascript:alert(1)", BASE)).toBeUndefined();
    // Scheme matching must not be fooled by case or padding.
    expect(toSafeImageUrl("  JaVaScRiPt:alert(1)  ", BASE)).toBeUndefined();
  });

  it("rejects data: and other schemes an attachment never legitimately uses", () => {
    expect(toSafeImageUrl("data:text/html,<script>alert(1)</script>", BASE)).toBeUndefined();
    expect(toSafeImageUrl("vbscript:msgbox(1)", BASE)).toBeUndefined();
    expect(toSafeImageUrl("file:///etc/passwd", BASE)).toBeUndefined();
  });

  it("rejects empty and unparseable values", () => {
    expect(toSafeImageUrl("", BASE)).toBeUndefined();
    expect(toSafeImageUrl("   ", BASE)).toBeUndefined();
    // No base to resolve against, and not absolute.
    expect(toSafeImageUrl("not a url", "")).toBeUndefined();
  });
});

describe("PowerWiki's internal image attributes", () => {
  it("strips a planted authenticated-image destination", () => {
    const sanitized = sanitizeRenderedHtml('<img data-powerwiki-image="javascript:alert(1)">');

    expect(sanitized).not.toContain("data-powerwiki-image");
    expect(sanitized).not.toContain("javascript:");
  });

  it("strips the planted source marker used by draw.io editing", () => {
    const sanitized = sanitizeRenderedHtml('<img data-powerwiki-image-src="https://attacker.example/collect">');

    expect(sanitized).not.toContain("data-powerwiki-image-src");
    expect(sanitized).not.toContain("attacker.example");
  });

  it("still validates a real src, which is why only the data-* path needs guarding", () => {
    expect(sanitizeRenderedHtml('<img src="javascript:alert(1)">')).not.toContain("javascript:");
  });

  it("still rejects unsafe values before they can reach img.src", () => {
    expect(toSafeImageUrl("javascript:alert(1)", BASE)).toBeUndefined();
  });
});
