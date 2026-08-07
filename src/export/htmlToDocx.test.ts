import { Document, Packer } from "docx";
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MERMAID_SOURCE_ATTR } from "../rendering/renderMermaidDiagrams";
import { htmlElementToDocxBlocks } from "./htmlToDocx";

// jsdom can't rasterize, so the canvas step is stubbed: these tests cover what
// htmlToDocx does with the result, including when rasterization fails.
const rasterizeSvgElement = vi.fn();
vi.mock("./svgToImage", () => ({
  rasterizeSvgElement: (svg: SVGElement) => rasterizeSvgElement(svg),
}));

const RASTERIZED = { data: new Uint8Array([1, 2, 3, 4]), width: 400, height: 300 };

// A minimal rendered-KaTeX element: the katex-mathml <math> carries the
// presentation MathML that becomes native Word math (OMML).
const KATEX_HTML = `<p>Inline <span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">E = mc^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">E=mc2</span></span>.</p>`;

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
  beforeEach(() => {
    rasterizeSvgElement.mockReset();
    rasterizeSvgElement.mockResolvedValue(RASTERIZED);
  });

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

  it("renders KaTeX as native Word math (OMML), not plain text", async () => {
    const blocks = await htmlElementToDocxBlocks(elementFrom(KATEX_HTML), {
      pagePath: "/Home",
      loadImage: async () => null,
    });
    const doc = new Document({ sections: [{ children: blocks }] });
    const buffer = await Packer.toBuffer(doc);

    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    // Native Word equations use the m: (math) namespace.
    expect(documentXml).toContain("oMath");
    // Guard against the ImportedXmlComponent wrapper leaking an invalid
    // <undefined> element, which makes Word refuse to open the file.
    expect(documentXml).not.toContain("<undefined>");
  });

  describe("Mermaid diagrams", () => {
    const RENDERED_DIAGRAM =
      `<pre class="mermaid-rendered" ${MERMAID_SOURCE_ATTR}="flowchart LR&#10;  A --&gt; B">` +
      `<svg id="powerwiki-mermaid-1"><text>A</text></svg></pre>`;

    it("embeds a rasterized diagram as an image", async () => {
      const blocks = await htmlElementToDocxBlocks(elementFrom(RENDERED_DIAGRAM), {
        pagePath: "/Home",
        loadImage: async () => null,
      });

      expect(rasterizeSvgElement).toHaveBeenCalledTimes(1);
      const doc = new Document({ sections: [{ children: blocks }] });
      const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
      expect(Object.keys(zip.files).some((name) => name.startsWith("word/media/"))).toBe(true);
    });

    // A diagram that can't be rasterized (tainted canvas, or one too big for a
    // canvas) used to collapse to a bare "[diagram]" marker, losing the content.
    it("falls back to the diagram source when rasterization fails", async () => {
      rasterizeSvgElement.mockResolvedValue(null);

      const blocks = await htmlElementToDocxBlocks(elementFrom(RENDERED_DIAGRAM), {
        pagePath: "/Home",
        loadImage: async () => null,
      });

      const doc = new Document({ sections: [{ children: blocks }] });
      const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
      const documentXml = await zip.file("word/document.xml")!.async("string");
      expect(documentXml).toContain("flowchart LR");
      expect(documentXml).not.toContain("[diagram]");
    });

    it("still emits a placeholder when there is no source to fall back to", async () => {
      rasterizeSvgElement.mockResolvedValue(null);

      const blocks = await htmlElementToDocxBlocks(elementFrom("<pre><svg></svg></pre>"), {
        pagePath: "/Home",
        loadImage: async () => null,
      });

      const doc = new Document({ sections: [{ children: blocks }] });
      const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
      expect(await zip.file("word/document.xml")!.async("string")).toContain("[diagram]");
    });
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
