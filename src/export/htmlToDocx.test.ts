import { Document, Packer } from "docx";
import { describe, expect, it } from "vitest";

import { htmlElementToDocxBlocks } from "./htmlToDocx";

function elementFrom(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

const HTML = `
  <h1>Title</h1>
  <p>Hello <strong>world</strong> with <em>emphasis</em>, <code>code</code>,
     and an <a href="https://example.com">external link</a>.</p>
  <h2>Section</h2>
  <ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>
  <blockquote><p>a quote</p></blockquote>
  <pre><code>const x = 1;</code></pre>
  <table>
    <thead><tr><th>Id</th><th>Title</th></tr></thead>
    <tbody><tr><td><a href="#" class="powerwiki-work-item-badge">#4</a></td><td>An item</td></tr></tbody>
  </table>
  <img data-export-src="/.attachments/x.png" src="/.attachments/x.png" alt="missing">
`;

describe("htmlElementToDocxBlocks", () => {
  it("converts enriched HTML into a valid .docx (zip)", async () => {
    const blocks = await htmlElementToDocxBlocks(elementFrom(HTML), {
      pagePath: "/Home",
      loadImage: async () => null,
    });
    expect(blocks.length).toBeGreaterThan(0);

    const doc = new Document({ sections: [{ children: blocks }] });
    const buffer = await Packer.toBuffer(doc);
    expect(buffer[0]).toBe(0x50); // P
    expect(buffer[1]).toBe(0x4b); // K
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it("renders a table (e.g. a query result) as a docx Table", async () => {
    const blocks = await htmlElementToDocxBlocks(
      elementFrom("<table><tr><th>A</th></tr><tr><td>1</td></tr></table>"),
      { pagePath: "/Home", loadImage: async () => null }
    );
    // The single top-level block should be a Table (constructor name check).
    expect(blocks.some((block) => block.constructor.name === "Table")).toBe(true);
  });
});
