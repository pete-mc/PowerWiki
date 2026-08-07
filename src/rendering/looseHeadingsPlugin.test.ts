import { describe, expect, it } from "vitest";

import { createMarkdownRenderer } from "./createMarkdownRenderer";

const md = createMarkdownRenderer();

describe("looseHeadingsPlugin", () => {
  it("renders a heading when the space after the hash is missing", () => {
    const html = md.render("#Overview");
    expect(html).toContain('<h1 id="overview"');
    expect(html).toContain("Overview");
    expect(html).not.toContain("<p>#Overview</p>");
  });

  it("renders every heading level without a space", () => {
    for (let level = 1; level <= 6; level++) {
      const html = md.render(`${"#".repeat(level)}Title`);
      expect(html).toContain(`<h${level} id="title"`);
      expect(html).toContain(`</h${level}>`);
    }
  });

  it("still renders the spaced form", () => {
    expect(md.render("## Spaced")).toContain('<h2 id="spaced"');
  });

  it("parses inline markup inside a spaceless heading", () => {
    const html = md.render("##**Bold** heading with `code`");
    expect(html).toContain("<h2");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("adds the permalink anchor to spaceless headings", () => {
    const html = md.render("#Anchored");
    expect(html).toContain("powerwiki-heading-anchor");
    expect(html).toContain('href="#anchored"');
  });

  it("trims a closing hash sequence", () => {
    const html = md.render("#Closed ###");
    expect(html).toContain('<h1 id="closed"');
    expect(html).not.toContain("###");
  });

  it("interrupts a paragraph, like a spaced heading does", () => {
    const html = md.render("Intro text\n#Next section");
    expect(html).toContain("<h1");
    expect(html).toContain("Next section");
  });

  it("renders inside a blockquote", () => {
    const html = md.render("> #Quoted heading");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<h1");
  });

  it("leaves more than six hashes as a paragraph", () => {
    const html = md.render("#######Too deep");
    expect(html).toContain("<p>#######Too deep</p>");
    expect(html).not.toContain("<h6");
  });

  it("leaves indented code blocks alone", () => {
    const html = md.render("    #Indented");
    expect(html).toContain("<pre><code>#Indented");
  });

  it("does not turn hashes inside a fenced code block into headings", () => {
    const html = md.render("```\n#NotAHeading\n```");
    expect(html).toContain("#NotAHeading");
    expect(html).not.toContain("<h1");
  });

  it("does not treat a mid-line hash as a heading", () => {
    const html = md.render("see the #notes section");
    expect(html).toContain("<p>");
    expect(html).not.toContain("<h1");
  });

  describe("work-item references still win over headings", () => {
    it("keeps #1234 at the start of a line as a work-item badge", () => {
      const html = md.render("#1234");
      expect(html).toContain('data-powerwiki-work-item-id="1234"');
      expect(html).not.toContain("<h1");
    });

    it("keeps a leading #1234 followed by prose as a badge", () => {
      const html = md.render("#1234 needs a repro");
      expect(html).toContain('data-powerwiki-work-item-id="1234"');
      expect(html).not.toContain("<h1");
      expect(html).toContain("needs a repro");
    });

    it("keeps #1234 mid-sentence as a badge", () => {
      const html = md.render("See #1234 for details.");
      expect(html).toContain('data-powerwiki-work-item-id="1234"');
    });

    it("does not treat a repeated hash run before a number as a heading", () => {
      const html = md.render("##1234");
      expect(html).not.toContain("<h2");
      expect(html).toContain('data-powerwiki-work-item-id="1234"');
    });

    it("renders a spaced heading whose text is a number as a heading", () => {
      const html = md.render("# 2024 roadmap");
      expect(html).toContain("<h1");
      expect(html).toContain("2024 roadmap");
    });

    it("leaves non-work-item digit runs as plain text", () => {
      const html = md.render("#0 is not a work item");
      expect(html).not.toContain("data-powerwiki-work-item-id");
      expect(html).not.toContain("<h1");
      expect(html).toContain("#0 is not a work item");
    });
  });
});
