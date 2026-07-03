import { describe, expect, it } from "vitest";

import { createMarkdownRenderer } from "./createMarkdownRenderer";

const md = createMarkdownRenderer();

describe("adoWorkItemsPlugin", () => {
  it("renders #1234 as an inline work-item badge", () => {
    const html = md.render("See #1234 for details.");
    expect(html).toContain('data-powerwiki-work-item-id="1234"');
    expect(html).toContain("powerwiki-work-item-badge");
  });

  it("does not convert #123 inside a link's text", () => {
    const html = md.render("[#123](https://example.com)");
    expect(html).not.toContain("data-powerwiki-work-item-id");
  });

  it("ignores hashes that are not work-item references", () => {
    const html = md.render("hex color #fff and #0 are not work items");
    expect(html).not.toContain("data-powerwiki-work-item-id");
  });

  it("renders an inline ::: query-table ::: placeholder", () => {
    const html = md.render("::: query-table 9a0fb95d-55b7-4fd3-af6b-30b8921ada61 :::");
    expect(html).toContain('data-powerwiki-query-id="9a0fb95d-55b7-4fd3-af6b-30b8921ada61"');
    expect(html).toContain("powerwiki-query-table");
  });

  it("renders a block query-table opener without a closing fence", () => {
    const html = md.render("::: query-table abc123");
    expect(html).toContain('data-powerwiki-query-id="abc123"');
  });
});
