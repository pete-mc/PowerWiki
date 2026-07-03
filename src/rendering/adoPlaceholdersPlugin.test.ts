import { describe, expect, it } from "vitest";

import { createMarkdownRenderer } from "./createMarkdownRenderer";
import { TOSP_PLACEHOLDER_ATTR, TOSP_PLACEHOLDER_VALUE } from "./adoPlaceholdersPlugin";

const md = createMarkdownRenderer();

describe("adoPlaceholdersPlugin", () => {
  it("renders [[_TOC_]] as a table of contents linking the page headings", () => {
    const html = md.render("[[_TOC_]]\n\n# First\n\n## Second");
    expect(html).toContain('class="powerwiki-toc"');
    expect(html).toContain('href="#first"');
    expect(html).toContain('href="#second"');
  });

  it("accepts [[TOC]] and [[_toc_]] variants", () => {
    expect(md.render("[[TOC]]\n\n# H")).toContain("powerwiki-toc");
    expect(md.render("[[_toc_]]\n\n# H")).toContain("powerwiki-toc");
  });

  it("renders [[_TOSP_]] as an empty subpage placeholder for the preview to fill", () => {
    const html = md.render("[[_TOSP_]]");
    expect(html).toContain(`${TOSP_PLACEHOLDER_ATTR}="${TOSP_PLACEHOLDER_VALUE}"`);
    expect(html).toContain("powerwiki-subpages");
  });

  it("only matches a placeholder that occupies its own line", () => {
    const html = md.render("text [[_TOC_]] more");
    expect(html).not.toContain("powerwiki-toc");
  });
});
