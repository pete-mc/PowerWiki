import { describe, expect, it } from "vitest";

import { isSafeImageUrl } from "./safeImageUrl";
import { sanitizeRenderedHtml } from "./sanitizeRenderedHtml";

const BASE = "https://dev.azure.com/org/project/";

describe("isSafeImageUrl", () => {
  it("allows the authenticated Git Items URLs the app builds", () => {
    expect(
      isSafeImageUrl(
        "https://dev.azure.com/org/project/_apis/git/repositories/abc/Items?path=%2F.attachments%2Fa.png",
        BASE
      )
    ).toBe(true);
  });

  it("allows http, for Azure DevOps Server behind plain http", () => {
    expect(isSafeImageUrl("http://tfs.internal/collection/x.png", BASE)).toBe(true);
  });

  it("allows the object URLs the preview creates for fetched attachments", () => {
    expect(isSafeImageUrl("blob:https://dev.azure.com/9f8e-4a1b", BASE)).toBe(true);
  });

  it("allows a relative path, which inherits the page's scheme", () => {
    expect(isSafeImageUrl("/.attachments/diagram.png", BASE)).toBe(true);
    expect(isSafeImageUrl("image.png", BASE)).toBe(true);
  });

  it("rejects javascript:", () => {
    expect(isSafeImageUrl("javascript:alert(1)", BASE)).toBe(false);
    // Scheme matching must not be fooled by case or padding.
    expect(isSafeImageUrl("  JaVaScRiPt:alert(1)  ", BASE)).toBe(false);
  });

  it("rejects data: and other schemes an attachment never legitimately uses", () => {
    expect(isSafeImageUrl("data:text/html,<script>alert(1)</script>", BASE)).toBe(false);
    expect(isSafeImageUrl("vbscript:msgbox(1)", BASE)).toBe(false);
    expect(isSafeImageUrl("file:///etc/passwd", BASE)).toBe(false);
  });

  it("rejects empty and unparseable values", () => {
    expect(isSafeImageUrl("", BASE)).toBe(false);
    expect(isSafeImageUrl("   ", BASE)).toBe(false);
    // No base to resolve against, and not absolute.
    expect(isSafeImageUrl("not a url", "")).toBe(false);
  });
});

describe("the sanitizer bypass this guards", () => {
  // Regression cover for the CodeQL js/xss-through-dom finding. The preview's
  // image enricher reads this attribute back out of the DOM *after*
  // sanitization, so the scheme check in isSafeImageUrl is the only thing
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
    expect(isSafeImageUrl(planted, BASE)).toBe(false);
  });
});
