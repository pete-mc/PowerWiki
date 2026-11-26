import { describe, expect, it } from "vitest";

import { createMarkdownRenderer } from "./createMarkdownRenderer";
import { sanitizeRenderedHtml } from "./sanitizeRenderedHtml";

const md = createMarkdownRenderer();

describe("sanitizeRenderedHtml", () => {
  it("sanitizes hostile HTML and URLs inside footnote content", () => {
    const markdown = 'Text[^n].\n\n[^n]: <img src=x onerror="alert(1)"> <script>alert(2)</script> <a href="javascript:alert(3)">bad</a>';
    const out = sanitizeRenderedHtml(md.render(markdown));
    const container = document.createElement("div");
    container.innerHTML = out;
    expect(container.querySelector(".footnote-item")).not.toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")?.hasAttribute("onerror")).toBe(false);
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });
  it("strips script tags", () => {
    const out = sanitizeRenderedHtml("<p>hi</p><script>alert(1)</script>");
    expect(out).toContain("<p>hi</p>");
    expect(out).not.toContain("<script");
  });

  it("keeps id and class attributes (heading anchors, mermaid)", () => {
    const out = sanitizeRenderedHtml('<h1 id="x" class="y">t</h1>');
    expect(out).toContain('id="x"');
    expect(out).toContain('class="y"');
  });

  it("keeps the powerwiki data attributes", () => {
    const out = sanitizeRenderedHtml('<a data-powerwiki-work-item-id="5">#5</a>');
    expect(out).toContain('data-powerwiki-work-item-id="5"');
  });

  it("preserves work-item and query attributes through the full render + sanitize pipeline", () => {
    const out = sanitizeRenderedHtml(md.render("#42\n\n::: query-table abc :::"));
    expect(out).toContain('data-powerwiki-work-item-id="42"');
    expect(out).toContain('data-powerwiki-query-id="abc"');
  });
});
