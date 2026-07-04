// Converts an enriched preview DOM element (produced by renderPageToElement)
// into docx block elements. Because it walks the *rendered* HTML, everything the
// preview produces comes across: query tables (as <table>), work-item badges (as
// styled text), embedded HTML, Mermaid (inline <svg> -> rasterized image), math
// (KaTeX -> its source TeX), lists, code, and images. Loaded lazily with docx.

import {
  AlignmentType,
  BorderStyle,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  ImportedXmlComponent,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
} from "docx";
import { mml2omml } from "mathml2omml";

import { rasterizeSvgElement } from "./mermaidToImage";
import { ORDERED_NUMBERING_REFERENCE, type DocxBlock, type ExportImage, type LoadExportImage } from "./types";

export interface HtmlToDocxContext {
  readonly loadImage: LoadExportImage;
  readonly pagePath: string;
}

interface InlineStyle {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
  hyperlink?: boolean;
}

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];
const MAX_IMAGE_WIDTH = 600;
const CODE_FILL = "F4F4F4";
const QUOTE_OPTS: IParagraphOptions = {
  indent: { left: 360 },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: "CCCCCC", space: 12 } },
};

export async function htmlElementToDocxBlocks(root: HTMLElement, ctx: HtmlToDocxContext): Promise<DocxBlock[]> {
  return blocksFromNode(root, ctx, {});
}

async function blocksFromNode(parent: Node, ctx: HtmlToDocxContext, opts: IParagraphOptions): Promise<DocxBlock[]> {
  const blocks: DocxBlock[] = [];

  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").trim();
      if (text) {
        blocks.push(new Paragraph({ ...opts, children: [new TextRun(text)] }));
      }
      continue;
    }
    if (!(node instanceof HTMLElement)) {
      continue;
    }

    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      blocks.push(new Paragraph({ heading: HEADINGS[Number(tag[1]) - 1], children: await inlineRuns(node, ctx, {}) }));
    } else if (tag === "p") {
      const runs = await inlineRuns(node, ctx, {});
      if (runs.length > 0) {
        blocks.push(new Paragraph({ ...opts, children: runs }));
      }
    } else if (tag === "ul") {
      blocks.push(...(await listBlocks(node, ctx, false, 0)));
    } else if (tag === "ol") {
      blocks.push(...(await listBlocks(node, ctx, true, 0)));
    } else if (tag === "blockquote") {
      blocks.push(...(await blocksFromNode(node, ctx, QUOTE_OPTS)));
    } else if (tag === "pre") {
      blocks.push(...(await preBlocks(node)));
    } else if (tag === "table") {
      blocks.push(await tableBlock(node, ctx));
    } else if (tag === "hr") {
      blocks.push(hrParagraph());
    } else if (tag === "img") {
      const image = await loadImageElement(node, ctx);
      if (image) {
        blocks.push(new Paragraph({ children: [imageRun(image)] }));
      }
    } else if (tag === "svg") {
      const png = await rasterizeSvgElement(node as unknown as SVGElement);
      if (png) {
        blocks.push(new Paragraph({ children: [imageRun({ ...png, type: "png" })] }));
      }
    } else if (node.classList.contains("powerwiki-math")) {
      // A block ("display") equation wrapper — emit a centered math paragraph.
      const runs = await inlineRuns(node, ctx, {});
      if (runs.length > 0) {
        const display = node.getAttribute("data-powerwiki-math") === "display";
        blocks.push(new Paragraph({ alignment: display ? AlignmentType.CENTER : undefined, children: runs }));
      }
    } else {
      // Callouts, divs, sections, spans that wrap block content — recurse.
      blocks.push(...(await blocksFromNode(node, ctx, opts)));
    }
  }

  return blocks;
}

async function preBlocks(pre: HTMLElement): Promise<DocxBlock[]> {
  const svg = pre.querySelector("svg");
  if (svg) {
    const png = await rasterizeSvgElement(svg);
    if (png) {
      return [new Paragraph({ children: [imageRun({ ...png, type: "png" })] })];
    }
    return [new Paragraph({ children: [new TextRun({ text: "[diagram]", italics: true })] })];
  }
  const code = pre.querySelector("code") ?? pre;
  return codeParagraphs(code.textContent ?? "");
}

async function listBlocks(list: HTMLElement, ctx: HtmlToDocxContext, ordered: boolean, level: number): Promise<DocxBlock[]> {
  const blocks: DocxBlock[] = [];
  const itemOpts: IParagraphOptions = ordered
    ? { numbering: { reference: ORDERED_NUMBERING_REFERENCE, level } }
    : { bullet: { level } };

  for (const item of Array.from(list.children)) {
    if (item.tagName.toLowerCase() !== "li") {
      continue;
    }
    const inlineNodes: Node[] = [];
    const nestedLists: HTMLElement[] = [];
    for (const child of Array.from(item.childNodes)) {
      if (child instanceof HTMLElement && (child.tagName.toLowerCase() === "ul" || child.tagName.toLowerCase() === "ol")) {
        nestedLists.push(child);
      } else {
        inlineNodes.push(child);
      }
    }
    const runs = await inlineRunsFromNodes(inlineNodes, ctx, {});
    if (runs.length > 0) {
      blocks.push(new Paragraph({ ...itemOpts, children: runs }));
    }
    for (const nested of nestedLists) {
      blocks.push(...(await listBlocks(nested, ctx, nested.tagName.toLowerCase() === "ol", level + 1)));
    }
  }

  return blocks;
}

async function tableBlock(table: HTMLElement, ctx: HtmlToDocxContext): Promise<Table> {
  const rows: TableRow[] = [];
  for (const rowEl of Array.from(table.querySelectorAll("tr"))) {
    const cells: TableCell[] = [];
    for (const cellEl of Array.from(rowEl.children)) {
      const tag = cellEl.tagName.toLowerCase();
      if (tag !== "th" && tag !== "td") {
        continue;
      }
      const runs = await inlineRuns(cellEl as HTMLElement, ctx, tag === "th" ? { bold: true } : {});
      cells.push(
        new TableCell({
          children: [new Paragraph({ children: runs.length > 0 ? runs : [new TextRun("")] })],
          ...(tag === "th" ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: CODE_FILL } } : {}),
        })
      );
    }
    if (cells.length > 0) {
      rows.push(new TableRow({ children: cells }));
    }
  }
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

async function inlineRuns(parent: HTMLElement, ctx: HtmlToDocxContext, style: InlineStyle): Promise<(TextRun | ExternalHyperlink | ImageRun)[]> {
  return inlineRunsFromNodes(Array.from(parent.childNodes), ctx, style);
}

async function inlineRunsFromNodes(
  nodes: readonly Node[],
  ctx: HtmlToDocxContext,
  style: InlineStyle
): Promise<(TextRun | ExternalHyperlink | ImageRun)[]> {
  const out: (TextRun | ExternalHyperlink | ImageRun)[] = [];

  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) {
        out.push(textRun(text, style));
      }
      continue;
    }
    if (!(node instanceof HTMLElement)) {
      continue;
    }

    // KaTeX: emit a native Word equation (OMML) from its MathML, falling back
    // to the source TeX as italic text if the equation can't be converted.
    if (node.classList.contains("katex")) {
      const math = katexToMath(node);
      if (math) {
        out.push(math as unknown as TextRun);
      } else {
        const tex = (node.querySelector("annotation")?.textContent ?? node.textContent ?? "").trim();
        if (tex) {
          out.push(textRun(tex, { ...style, italics: true }));
        }
      }
      continue;
    }

    const tag = node.tagName.toLowerCase();
    switch (tag) {
      case "br":
        out.push(new TextRun({ break: 1 }));
        break;
      case "strong":
      case "b":
        out.push(...(await inlineRunsFromNodes(Array.from(node.childNodes), ctx, { ...style, bold: true })));
        break;
      case "em":
      case "i":
        out.push(...(await inlineRunsFromNodes(Array.from(node.childNodes), ctx, { ...style, italics: true })));
        break;
      case "s":
      case "del":
      case "strike":
        out.push(...(await inlineRunsFromNodes(Array.from(node.childNodes), ctx, { ...style, strike: true })));
        break;
      case "code":
        out.push(...(await inlineRunsFromNodes(Array.from(node.childNodes), ctx, { ...style, code: true })));
        break;
      case "a": {
        const href = node.getAttribute("href") ?? "";
        const external = /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
        const inner = await inlineRunsFromNodes(Array.from(node.childNodes), ctx, { ...style, hyperlink: external });
        if (external && inner.length > 0) {
          out.push(new ExternalHyperlink({ link: href, children: inner }));
        } else {
          out.push(...inner);
        }
        break;
      }
      case "img": {
        const image = await loadImageElement(node, ctx);
        if (image) {
          out.push(imageRun(image));
        } else {
          const alt = node.getAttribute("alt");
          if (alt) {
            out.push(textRun(`[${alt}]`, { ...style, italics: true }));
          }
        }
        break;
      }
      default:
        out.push(...(await inlineRunsFromNodes(Array.from(node.childNodes), ctx, style)));
        break;
    }
  }

  return out;
}

/**
 * Converts a rendered KaTeX element to a native Word equation (OMML) via its
 * MathML. Returns null if there's no MathML or the conversion fails, so the
 * caller can fall back to the source TeX text.
 */
function katexToMath(katex: HTMLElement): ImportedXmlComponent | null {
  const math = katex.querySelector("math");
  if (!math) {
    return null;
  }
  const clone = math.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("annotation").forEach((annotation) => annotation.remove());
  try {
    const omml = mml2omml(clone.outerHTML);
    if (!omml || !omml.includes("oMath")) {
      return null;
    }
    // Guard against malformed OMML (unsupported MathML constructs) corrupting
    // the whole document — fall back to TeX text instead.
    if (new DOMParser().parseFromString(omml, "application/xml").querySelector("parsererror")) {
      return null;
    }
    // fromXmlString wraps the parsed OMML under a nameless root; using that
    // wrapper directly emits an invalid <undefined> element that makes Word
    // refuse to open the file. The real <m:oMath> is its first child.
    const wrapper = ImportedXmlComponent.fromXmlString(omml) as unknown as { readonly root?: readonly unknown[] };
    const mathElement = wrapper.root?.[0];
    if (!mathElement || typeof mathElement !== "object") {
      return null;
    }
    return mathElement as ImportedXmlComponent;
  } catch {
    return null;
  }
}

function textRun(text: string, style: InlineStyle): TextRun {
  return new TextRun({
    text,
    bold: style.bold,
    italics: style.italics,
    strike: style.strike,
    font: style.code ? "Consolas" : undefined,
    shading: style.code ? { type: ShadingType.CLEAR, color: "auto", fill: CODE_FILL } : undefined,
    style: style.hyperlink ? "Hyperlink" : undefined,
  });
}

function codeParagraphs(content: string): Paragraph[] {
  return content
    .replace(/\n$/, "")
    .split("\n")
    .map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line.length > 0 ? line : " ", font: "Consolas", size: 18 })],
          shading: { type: ShadingType.CLEAR, color: "auto", fill: CODE_FILL },
          spacing: { after: 0, line: 240 },
        })
    );
}

function hrParagraph(): Paragraph {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
    spacing: { before: 120, after: 120 },
  });
}

function imageRun(image: ExportImage): ImageRun {
  let width = image.width || MAX_IMAGE_WIDTH;
  let height = image.height || Math.round(width * 0.6);
  if (width > MAX_IMAGE_WIDTH) {
    height = Math.round((height * MAX_IMAGE_WIDTH) / width);
    width = MAX_IMAGE_WIDTH;
  }
  return new ImageRun({ data: image.data, type: image.type, transformation: { width, height } });
}

async function loadImageElement(img: HTMLElement, ctx: HtmlToDocxContext): Promise<ExportImage | null> {
  // renderPageToElement stashes the original wiki src in data-export-src (the
  // visible src is a resolved display URL that the Git client can't fetch).
  const src = img.getAttribute("data-export-src") || img.getAttribute("src") || "";
  if (!src) {
    return null;
  }
  return ctx.loadImage(src, ctx.pagePath);
}
