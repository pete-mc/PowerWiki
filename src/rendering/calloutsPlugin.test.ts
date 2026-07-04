import { describe, expect, it } from "vitest";

import { createMarkdownRenderer } from "./createMarkdownRenderer";

const md = createMarkdownRenderer();

describe("calloutsPlugin", () => {
  it("renders a [!NOTE] blockquote as a note callout with a title", () => {
    const html = md.render("> [!NOTE]\n> Useful info.");
    expect(html).toContain("powerwiki-callout-note");
    expect(html).toContain("powerwiki-callout-title");
    expect(html).toContain("Useful info.");
    expect(html).not.toContain("[!NOTE]");
  });

  it("supports all alert types case-insensitively", () => {
    for (const type of ["TIP", "important", "Warning", "caution"]) {
      const html = md.render(`> [!${type}]\n> body`);
      expect(html).toContain(`powerwiki-callout-${type.toLowerCase()}`);
    }
  });

  it("handles the marker with an inline body on the same line", () => {
    const html = md.render("> [!WARNING] Watch out.");
    expect(html).toContain("powerwiki-callout-warning");
    expect(html).toContain("Watch out.");
  });

  it("leaves ordinary blockquotes untouched", () => {
    const html = md.render("> just a quote");
    expect(html).not.toContain("powerwiki-callout");
    expect(html).toContain("just a quote");
  });
});
