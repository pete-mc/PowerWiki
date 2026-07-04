import { describe, expect, it } from "vitest";

import { createMarkdownRenderer } from "./createMarkdownRenderer";

const md = createMarkdownRenderer();

describe("createMarkdownRenderer", () => {
  it("adds slugged anchor ids to headings", () => {
    const html = md.render("# Hello World");
    expect(html).toContain('<h1 id="hello-world"');
  });

  it("adds a hover permalink anchor inside headings", () => {
    const html = md.render("# Title");
    expect(html).toContain("powerwiki-heading-anchor");
    expect(html).toContain('href="#title"');
  });

  it("renders GFM tables", () => {
    const html = md.render("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td>1</td>");
  });

  it("emits <pre class=\"mermaid\"> for ```mermaid fences (no <code> wrapper)", () => {
    const html = md.render("```mermaid\nflowchart LR\n  A --> B\n```");
    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain("flowchart LR");
    expect(html).not.toMatch(/<code/);
  });

  it("converts ::: mermaid containers into mermaid fences", () => {
    const html = md.render(":::mermaid\nflowchart LR\n  A --> B\n:::");
    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain("flowchart LR");
  });

  it("renders non-mermaid fences as ordinary code blocks", () => {
    const html = md.render("```ts\nconst x = 1;\n```");
    expect(html).toMatch(/<pre><code/);
    expect(html).not.toContain('class="mermaid"');
  });
});
