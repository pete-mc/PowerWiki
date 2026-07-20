import { describe, expect, it } from "vitest";

import { createMarkdownRenderer } from "./createMarkdownRenderer";
import { sanitizeRenderedHtml } from "./sanitizeRenderedHtml";

const md = createMarkdownRenderer();

// The GUID casing here matches what Azure DevOps actually writes into the
// Markdown source.
const MENTION = "@<35FF1E12-A3C5-6534-88A9-B47078970801>";

describe("adoMentionsPlugin", () => {
  it("turns an @<guid> mention into an enrichable placeholder", () => {
    const html = md.render(`Assigned to ${MENTION} today.`);
    expect(html).toContain('data-powerwiki-mention-id="35FF1E12-A3C5-6534-88A9-B47078970801"');
    expect(html).toContain("powerwiki-mention");
    // The raw tag must not survive into the rendered page.
    expect(html).not.toContain("@&lt;");
  });

  it("keeps the surrounding text intact", () => {
    const html = md.render(`before ${MENTION} after`);
    expect(html).toContain("before ");
    expect(html).toContain(" after");
  });

  it("handles several mentions in one paragraph", () => {
    const other = "@<0f0c2f97-1c2a-4d3e-9a8b-1c2d3e4f5a6b>";
    const html = md.render(`${MENTION} and ${other}`);
    expect(html).toContain('data-powerwiki-mention-id="35FF1E12-A3C5-6534-88A9-B47078970801"');
    expect(html).toContain('data-powerwiki-mention-id="0f0c2f97-1c2a-4d3e-9a8b-1c2d3e4f5a6b"');
  });

  it("leaves @ text that is not an identity mention alone", () => {
    const html = md.render("email me @home or @<not-a-guid>");
    expect(html).not.toContain("data-powerwiki-mention-id");
  });

  it("does not rewrite mentions inside code", () => {
    const html = md.render(`\`${MENTION}\``);
    expect(html).not.toContain("data-powerwiki-mention-id");
  });

  it("survives sanitization", () => {
    const html = sanitizeRenderedHtml(md.render(MENTION));
    expect(html).toContain('data-powerwiki-mention-id="35FF1E12-A3C5-6534-88A9-B47078970801"');
  });
});
