import { describe, expect, it } from "vitest";

import { createMarkdownRenderer } from "./createMarkdownRenderer";
import { sanitizeRenderedHtml } from "./sanitizeRenderedHtml";

const md = createMarkdownRenderer();

describe("adoImageSizePlugin", () => {
  it("applies both dimensions", () => {
    const html = md.render("![Alt text](./image.png =500x250)");
    expect(html).toContain('src="./image.png"');
    expect(html).toContain('width="500"');
    expect(html).toContain('height="250"');
    expect(html).toContain('alt="Alt text"');
  });

  it("applies a width-only size", () => {
    const html = md.render("![Alt text](./image.png =500x)");
    expect(html).toContain('width="500"');
    expect(html).not.toContain("height=");
  });

  it("applies a height-only size", () => {
    const html = md.render("![Alt text](./image.png =x250)");
    expect(html).toContain('height="250"');
    expect(html).not.toContain("width=");
  });

  it("keeps a plain image working", () => {
    const html = md.render("![Alt text](./image.png)");
    expect(html).toContain('src="./image.png"');
    expect(html).not.toContain("width=");
  });

  it("keeps a titled image working", () => {
    const html = md.render('![Alt text](./image.png "A title")');
    expect(html).toContain('title="A title"');
    expect(html).not.toContain("width=");
  });

  it("resolves the size on an absolute wiki attachment path", () => {
    const html = md.render("![diagram](/.attachments/diagram-abc123.png =800x)");
    expect(html).toContain('src="/.attachments/diagram-abc123.png"');
    expect(html).toContain('width="800"');
  });

  it("renders inline markup in the alt text", () => {
    const html = md.render("![a *b* c](./image.png =100x100)");
    expect(html).toContain('alt="a b c"');
  });

  it("survives sanitization", () => {
    const html = sanitizeRenderedHtml(md.render("![Alt text](./image.png =500x250)"));
    expect(html).toContain('width="500"');
    expect(html).toContain('height="250"');
  });

  it("leaves a sized image inside a link intact", () => {
    const html = md.render("[![Alt text](./image.png =60x60)](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('width="60"');
  });

  it("ignores a size with no dimensions at all", () => {
    // "=x" carries no information; fall through so markdown-it decides.
    const html = md.render("![Alt text](./image.png =x)");
    expect(html).not.toContain("width=");
    expect(html).not.toContain("height=");
  });

  it("requires a space before the size, as Azure DevOps does", () => {
    const html = md.render("![Alt text](./image.png=500x250)");
    expect(html).not.toContain('width="500"');
  });

  it("does not treat a sized image in code as markup", () => {
    const html = md.render("`![Alt text](./image.png =500x250)`");
    expect(html).not.toContain("<img");
    expect(html).toContain("<code>");
  });
});
