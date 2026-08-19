// Orchestrates a Word (.docx) export. Each page is rendered through the shared
// enriched-HTML pipeline (so query tables, work-item badges, embedded HTML,
// Mermaid, and math come across) and then converted to docx blocks, combined
// into one document (page-title headings + page breaks), and downloaded.

import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  PageBreak,
  Packer,
  Paragraph,
  PatchType,
  TextRun,
  patchDocument,
} from "docx";

import { htmlElementToDocxBlocks } from "./htmlToDocx";
import { renderPageToElement, type PageRenderOptions } from "./renderPageHtml";
import { ORDERED_NUMBERING_REFERENCE, type DocxBlock, type LoadExportImage } from "./types";
import { TEMPLATE_PLACEHOLDER, type WordTemplate } from "./wordTemplate";

export interface ExportPage {
  readonly title: string;
  readonly path: string;
  readonly content: string;
}

const ORDERED_LEVELS = [0, 1, 2, 3, 4, 5].map((level) => ({
  level,
  format: LevelFormat.DECIMAL,
  text: `%${level + 1}.`,
  alignment: AlignmentType.START,
  style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
}));

/**
 * Builds a .docx from the given pages and hands it to `save`.
 *
 * Delivery is the caller's (host's) business: a browser starts a download, and
 * a VS Code webview cannot — it has to send the bytes to the extension host,
 * which asks where to put them.
 *
 * With a `template`, the document takes the customer's own Word styling instead
 * of PowerWiki's; see `wordTemplate.ts` for how the two mechanisms differ and
 * why the choice is made from the template's contents rather than by the user.
 */
export async function exportPagesToWord(
  pages: readonly ExportPage[],
  renderOptions: PageRenderOptions,
  loadImage: LoadExportImage,
  fileName: string,
  save: (fileName: string, blob: Blob) => Promise<void>,
  template?: WordTemplate
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

    // plainDiagramLabels keeps Mermaid out of <foreignObject>, which is what
    // lets htmlToDocx rasterize each diagram into the document.
    const element = await renderPageToElement(page.content, {
      ...renderOptions,
      currentPath: page.path,
      plainDiagramLabels: true,
    });
    try {
      children.push(...(await htmlElementToDocxBlocks(element, { loadImage, pagePath: page.path })));
    } finally {
      element.remove();
    }
  }

  // A template that says where the content goes gets it put there, so its cover
  // page, headers, footers, and page setup stay wrapped around the export.
  if (template?.hasPlaceholder) {
    const patched = await patchDocument({
      outputType: "blob",
      data: template.data,
      patches: { [TEMPLATE_PLACEHOLDER]: { type: PatchType.DOCUMENT, children } },
    });
    await save(fileName, patched);
    return;
  }

  const document = new Document({
    creator: "PowerWiki",
    title: fileName.replace(/\.docx$/i, ""),
    numbering: { config: [{ reference: ORDERED_NUMBERING_REFERENCE, levels: ORDERED_LEVELS }] },
    // A template without a placeholder still contributes its styles, so
    // headings and body text match the customer's house look even though its
    // layout cannot come across. Without one, PowerWiki's own default applies.
    ...(template?.stylesXml
      ? { externalStyles: template.stylesXml }
      : { styles: { default: { document: { run: { font: "Calibri", size: 22 } } } } }),
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(document);
  await save(fileName, blob);
}
