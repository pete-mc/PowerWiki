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
    expect(html).toContain("<table");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td>1</td>");
  });

  it("emits <pre class=\"mermaid\"> for ```mermaid fences (no <code> wrapper)", () => {
    const html = md.render("```mermaid\nflowchart LR\n  A --> B\n```");
    expect(html).toContain('<pre class="mermaid"');
    expect(html).toContain("flowchart LR");
    expect(html).not.toMatch(/<code/);
  });

  it("converts ::: mermaid containers into mermaid fences", () => {
    const html = md.render(":::mermaid\nflowchart LR\n  A --> B\n:::");
    expect(html).toContain('<pre class="mermaid"');
    expect(html).toContain("flowchart LR");
  });

  it("renders non-mermaid fences as ordinary code blocks", () => {
    const html = md.render("```ts\nconst x = 1;\n```");
    expect(html).toMatch(/<pre><code/);
    expect(html).not.toContain('class="mermaid"');
  });

  it("renders emoji shortcodes as their characters", () => {
    expect(md.render(":green_circle: ready")).toContain("\u{1F7E2} ready");
    expect(md.render(":tada:")).toContain("\u{1F389}");
  });

  it("renders shortcodes the bundled dataset predates", () => {
    // Unicode 15.1 and 16.0, from the supplement in emojiPlugin.ts.
    expect(md.render(":lime:")).toContain("\u{1F34B}\u{200D}\u{1F7E9}");
    expect(md.render(":fingerprint:")).toContain("\u{1FAC6}");
  });

  it("leaves unknown shortcodes and code spans alone", () => {
    expect(md.render(":not_an_emoji:")).toContain(":not_an_emoji:");
    expect(md.render("`:green_circle:`")).toContain("<code>:green_circle:</code>");
    expect(md.render("```\n:green_circle:\n```")).toContain(":green_circle:");
  });

  it("does not convert ASCII emoticons, which appear in ordinary text", () => {
    const html = md.render("Serve from C:/wiki :) and note the 8-) range");
    expect(html).toContain("C:/wiki :)");
    expect(html).toContain("8-)");
  });
});
