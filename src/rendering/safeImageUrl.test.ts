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

describe("the sanitizer bypass this guards", () => {
  // Regression cover for the CodeQL js/xss-through-dom finding. The preview's
  // image enricher reads this attribute back out of the DOM *after*
  // sanitization, so the scheme check in toSafeImageUrl is the only thing
  // standing between a page author and `img.src`.
  it("confirms DOMPurify does NOT strip a planted data-powerwiki-image", () => {
    const sanitized = sanitizeRenderedHtml('<img data-powerwiki-image="javascript:alert(1)">');

    // If this ever starts failing because DOMPurify began stripping the
    // attribute, the guard below is still correct — belt and braces.
    expect(sanitized).toContain("data-powerwiki-image");
    expect(sanitized).toContain("javascript:");
  });

  it("still validates a real src, which is why only the data-* path needs guarding", () => {
    expect(sanitizeRenderedHtml('<img src="javascript:alert(1)">')).not.toContain("javascript:");
  });

  it("rejects the planted value before it can reach img.src", () => {
    const sanitized = sanitizeRenderedHtml('<img data-powerwiki-image="javascript:alert(1)">');
    const host = document.createElement("div");
    host.innerHTML = sanitized;
    const planted = host.querySelector("img")?.getAttribute("data-powerwiki-image") ?? "";

    expect(planted).toBe("javascript:alert(1)");
    expect(toSafeImageUrl(planted, BASE)).toBeUndefined();
  });
});
