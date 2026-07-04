// Converts Markdown into docx (OOXML) block elements, mapping structure to
// native Word features: Markdown headings become Word Heading styles, lists use
// Word bullets/numbering, tables become Word tables, and Mermaid diagrams are
// rasterized to embedded images. Loaded lazily (it pulls in the docx library).

import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import {
  BorderStyle,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
} from "docx";

import { mermaidToPng } from "./mermaidToImage";

export interface ExportImage {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly type: "png" | "jpg" | "gif" | "bmp";
}

export interface DocxRenderContext {
  /** Resolves a Markdown image src to raw bytes + dimensions, or null to skip. */
  readonly loadImage: (src: string) => Promise<ExportImage | null>;
}

export type DocxBlock = Paragraph | Table;
export const ORDERED_NUMBERING_REFERENCE = "pw-ordered";

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

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
let mermaidCounter = 0;

/** Parses Markdown and returns docx block elements for one page's content. */
export async function markdownToDocxBlocks(markdown: string, ctx: DocxRenderContext): Promise<DocxBlock[]> {
  const tokens = md.parse(preprocess(markdown), {});
  const cursor = { tokens, i: 0 };
  return parseBlocks(cursor, ctx);
}

// Normalizes the Azure DevOps ":::mermaid" container syntax to a fenced block so
// the token walker only has to handle ```mermaid fences.
function preprocess(markdown: string): string {
  return markdown.replace(/^:::\s*mermaid\s*$([\s\S]*?)^:::\s*$/gim, (_all, body) => "```mermaid\n" + String(body).replace(/^\n/, "").replace(/\n$/, "") + "\n```");
}

interface Cursor {
  readonly tokens: Token[];
  i: number;
}

async function parseBlocks(cursor: Cursor, ctx: DocxRenderContext, stop?: string, opts: IParagraphOptions = {}): Promise<DocxBlock[]> {
  const blocks: DocxBlock[] = [];

  while (cursor.i < cursor.tokens.length) {
    const token = cursor.tokens[cursor.i];
    if (stop && token.type === stop) {
      cursor.i += 1;
      return blocks;
    }

    switch (token.type) {
      case "heading_open": {
        const level = Math.min(6, Math.max(1, Number(token.tag.slice(1)) || 1));
        cursor.i += 1;
        const runs = await inlineToRuns(cursor.tokens[cursor.i], ctx);
        cursor.i += 2; // inline + heading_close
        blocks.push(new Paragraph({ heading: HEADINGS[level - 1], children: runs }));
        break;
      }
      case "paragraph_open": {
        cursor.i += 1;
        const runs = await inlineToRuns(cursor.tokens[cursor.i], ctx);
        cursor.i += 2; // inline + paragraph_close
        blocks.push(new Paragraph({ ...opts, children: runs }));
        break;
      }
      case "bullet_list_open":
        cursor.i += 1;
        blocks.push(...(await parseList(cursor, ctx, false, 0)));
        break;
      case "ordered_list_open":
        cursor.i += 1;
        blocks.push(...(await parseList(cursor, ctx, true, 0)));
        break;
      case "blockquote_open":
        cursor.i += 1;
        blocks.push(...(await parseBlocks(cursor, ctx, "blockquote_close", QUOTE_OPTS)));
        break;
      case "fence":
        cursor.i += 1;
        blocks.push(...(await fenceToBlocks(token)));
        break;
      case "code_block":
        cursor.i += 1;
        blocks.push(...codeToBlocks(token.content));
        break;
      case "hr":
        cursor.i += 1;
        blocks.push(hrParagraph());
        break;
      case "table_open":
        blocks.push(await parseTable(cursor, ctx));
        break;
      default:
        cursor.i += 1;
        break;
    }
  }

  return blocks;
}

const QUOTE_OPTS: IParagraphOptions = {
  indent: { left: 360 },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: "CCCCCC", space: 12 } },
};

async function parseList(cursor: Cursor, ctx: DocxRenderContext, ordered: boolean, level: number): Promise<DocxBlock[]> {
  const stop = ordered ? "ordered_list_close" : "bullet_list_close";
  const blocks: DocxBlock[] = [];

  while (cursor.i < cursor.tokens.length && cursor.tokens[cursor.i].type !== stop) {
    if (cursor.tokens[cursor.i].type === "list_item_open") {
      cursor.i += 1;
      blocks.push(...(await parseListItem(cursor, ctx, ordered, level)));
    } else {
      cursor.i += 1;
    }
  }
  cursor.i += 1; // list close
  return blocks;
}

function listParagraphOpts(ordered: boolean, level: number): IParagraphOptions {
  return ordered ? { numbering: { reference: ORDERED_NUMBERING_REFERENCE, level } } : { bullet: { level } };
}

async function parseListItem(cursor: Cursor, ctx: DocxRenderContext, ordered: boolean, level: number): Promise<DocxBlock[]> {
  const blocks: DocxBlock[] = [];

  while (cursor.i < cursor.tokens.length && cursor.tokens[cursor.i].type !== "list_item_close") {
    const token = cursor.tokens[cursor.i];
    if (token.type === "paragraph_open" || token.type === "inline") {
      if (token.type === "paragraph_open") {
        cursor.i += 1;
      }
      const runs = await inlineToRuns(cursor.tokens[cursor.i], ctx);
      cursor.i += token.type === "paragraph_open" ? 2 : 1;
      blocks.push(new Paragraph({ ...listParagraphOpts(ordered, level), children: runs }));
    } else if (token.type === "bullet_list_open") {
      cursor.i += 1;
      blocks.push(...(await parseList(cursor, ctx, false, level + 1)));
    } else if (token.type === "ordered_list_open") {
      cursor.i += 1;
      blocks.push(...(await parseList(cursor, ctx, true, level + 1)));
    } else if (token.type === "fence") {
      cursor.i += 1;
      blocks.push(...(await fenceToBlocks(token)));
    } else {
      cursor.i += 1;
    }
  }
  cursor.i += 1; // list_item_close
  return blocks;
}

async function parseTable(cursor: Cursor, ctx: DocxRenderContext): Promise<Table> {
  cursor.i += 1; // table_open
  const rows: TableRow[] = [];
  let inHeader = false;

  while (cursor.i < cursor.tokens.length && cursor.tokens[cursor.i].type !== "table_close") {
    const token = cursor.tokens[cursor.i];
    if (token.type === "thead_open") {
      inHeader = true;
      cursor.i += 1;
    } else if (token.type === "thead_close") {
      inHeader = false;
      cursor.i += 1;
    } else if (token.type === "tr_open") {
      cursor.i += 1;
      const cells: TableCell[] = [];
      const headerRow = inHeader;
      while (cursor.i < cursor.tokens.length && cursor.tokens[cursor.i].type !== "tr_close") {
        const cellToken = cursor.tokens[cursor.i];
        if (cellToken.type === "th_open" || cellToken.type === "td_open") {
          cursor.i += 1;
          const runs = cursor.tokens[cursor.i]?.type === "inline" ? await inlineToRuns(cursor.tokens[cursor.i], ctx) : [];
          while (cursor.i < cursor.tokens.length && cursor.tokens[cursor.i].type !== "th_close" && cursor.tokens[cursor.i].type !== "td_close") {
            cursor.i += 1;
          }
          cursor.i += 1; // th_close / td_close
          cells.push(
            new TableCell({
              children: [new Paragraph({ children: runs.length > 0 ? runs : [new TextRun("")] })],
              ...(headerRow ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: CODE_FILL } } : {}),
            })
          );
        } else {
          cursor.i += 1;
        }
      }
      cursor.i += 1; // tr_close
      rows.push(new TableRow({ children: cells, tableHeader: headerRow }));
    } else {
      cursor.i += 1;
    }
  }
  cursor.i += 1; // table_close

  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

async function fenceToBlocks(token: Token): Promise<DocxBlock[]> {
  const info = (token.info || "").trim().toLowerCase().split(/\s+/)[0];
  if (info === "mermaid") {
    const png = await mermaidToPng(token.content, mermaidCounter++);
    if (png) {
      return [new Paragraph({ children: [imageRun({ ...png, type: "png" })] })];
    }
    return [new Paragraph({ children: [new TextRun({ text: "[Mermaid diagram]", italics: true })] })];
  }
  return codeToBlocks(token.content);
}

function codeToBlocks(content: string): Paragraph[] {
  const lines = content.replace(/\n$/, "").split("\n");
  return lines.map(
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

async function inlineToRuns(
  inline: Token | undefined,
  ctx: DocxRenderContext
): Promise<(TextRun | ExternalHyperlink | ImageRun)[]> {
  const out: (TextRun | ExternalHyperlink | ImageRun)[] = [];
  if (!inline?.children) {
    return out;
  }

  let bold = false;
  let italics = false;
  let strike = false;
  let link: { href: string; runs: (TextRun | ImageRun)[] } | null = null;
  const push = (run: TextRun | ImageRun) => (link ? link.runs.push(run) : out.push(run));

  for (const child of inline.children) {
    switch (child.type) {
      case "text":
        push(new TextRun({ text: child.content, bold, italics, strike, style: link ? "Hyperlink" : undefined }));
        break;
      case "strong_open":
        bold = true;
        break;
      case "strong_close":
        bold = false;
        break;
      case "em_open":
        italics = true;
        break;
      case "em_close":
        italics = false;
        break;
      case "s_open":
        strike = true;
        break;
      case "s_close":
        strike = false;
        break;
      case "code_inline":
        push(new TextRun({ text: child.content, font: "Consolas", shading: { type: ShadingType.CLEAR, color: "auto", fill: CODE_FILL } }));
        break;
      case "softbreak":
        push(new TextRun({ text: " " }));
        break;
      case "hardbreak":
        push(new TextRun({ break: 1 }));
        break;
      case "link_open":
        link = { href: attr(child, "href"), runs: [] };
        break;
      case "link_close":
        if (link) {
          out.push(
            new ExternalHyperlink({
              link: link.href,
              children: link.runs.length > 0 ? link.runs : [new TextRun({ text: link.href, style: "Hyperlink" })],
            })
          );
          link = null;
        }
        break;
      case "image": {
        const image = await ctx.loadImage(attr(child, "src"));
        if (image) {
          push(imageRun(image));
        } else {
          push(new TextRun({ text: `[${child.content || "image"}]`, italics: true }));
        }
        break;
      }
      default:
        if (child.content) {
          push(new TextRun({ text: child.content, bold, italics, strike }));
        }
        break;
    }
  }

  return out;
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

function attr(token: Token, name: string): string {
  const found = token.attrs?.find(([key]) => key === name);
  return found ? found[1] : "";
}
