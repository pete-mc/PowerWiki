// Orchestrates a Word (.docx) export: converts one or more pages' Markdown to
// docx blocks, combines them into a single document (page-title headings and
// page breaks between pages), and triggers a download. Loaded lazily.

import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  PageBreak,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

import { markdownToDocxBlocks, ORDERED_NUMBERING_REFERENCE, type DocxBlock, type ExportImage } from "./markdownToDocx";

export interface ExportPage {
  readonly title: string;
  readonly path: string;
  readonly content: string;
}

/** Resolves a Markdown image src (relative to pagePath) to bytes, or null. */
export type LoadExportImage = (src: string, pagePath: string) => Promise<ExportImage | null>;

const ORDERED_LEVELS = [0, 1, 2, 3, 4, 5].map((level) => ({
  level,
  format: LevelFormat.DECIMAL,
  text: `%${level + 1}.`,
  alignment: AlignmentType.START,
  style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
}));

/** Builds a .docx from the given pages and downloads it as fileName. */
export async function exportPagesToWord(
  pages: readonly ExportPage[],
  loadImage: LoadExportImage,
  fileName: string
): Promise<void> {
  const children: DocxBlock[] = [];
  const multi = pages.length > 1;

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    if (index > 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
    if (multi) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(page.title)] }));
    }
    children.push(...(await markdownToDocxBlocks(page.content, { loadImage: (src) => loadImage(src, page.path) })));
  }

  const document = new Document({
    creator: "PowerWiki",
    title: fileName.replace(/\.docx$/i, ""),
    numbering: { config: [{ reference: ORDERED_NUMBERING_REFERENCE, levels: ORDERED_LEVELS }] },
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(document);
  downloadBlob(blob, fileName);
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
