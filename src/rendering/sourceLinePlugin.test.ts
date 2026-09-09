import { describe, expect, it } from "vitest";

import { createMarkdownRenderer } from "./createMarkdownRenderer";
import { SOURCE_LINE_ATTR } from "./sourceLinePlugin";

const md = createMarkdownRenderer();

/** The line numbers stamped on the rendered HTML, in document order. */
function stampedLines(markdown: string): number[] {
  const html = md.render(markdown);
  return [...html.matchAll(new RegExp(`${SOURCE_LINE_ATTR}="(\\d+)"`, "g"))].map((match) =>
    Number(match[1])
  );
}

describe("sourceLinePlugin", () => {
  it("stamps each block with the 1-based line it starts on", () => {
    // Line 1 is the heading, line 3 the paragraph, line 5 the second paragraph.
    expect(stampedLines("# Title\n\nFirst\n\nSecond")).toEqual([1, 3, 5]);
  });

  it("stamps the list, not every item inside it", () => {
    // Deliberate: an anchor per item would put an attribute on every row of
    // every table too, and the mapping interpolates across the gap anyway.
    expect(stampedLines("- one\n- two\n\n> quoted")).toEqual([1, 4]);
  });

  it("stamps a mermaid block, which is tall enough to matter most", () => {
    const html = md.render("Intro\n\n```mermaid\nflowchart LR\n  A --> B\n```");

    expect(html).toContain(`<pre class="mermaid" ${SOURCE_LINE_ATTR}="3"`);
  });

  it("keeps the line ascending down the document, so the mapping can bisect", () => {
    const lines = stampedLines("# A\n\npara\n\n## B\n\n- item\n\n## C\n\nend");

    expect([...lines].sort((a, b) => a - b)).toEqual(lines);
  });
});
