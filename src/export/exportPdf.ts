// PDF export via the browser's native print. Rather than a separate print
// window (which loses the app's fonts and lazily-loaded CSS), we render the
// enriched pages into a hidden node in the *current* document and use an
// @media print stylesheet to show only that node — so Mermaid SVG, KaTeX math,
// tables, and images all print at full fidelity, with selectable text.

import { renderPageToElement, type PageRenderOptions } from "./renderPageHtml";

export type { PageRenderOptions };

export interface ExportPage {
  readonly title: string;
  readonly path: string;
  readonly content: string;
}

const PRINT_STYLE_ID = "pw-print-style";
const PRINT_CSS = `
@media screen { .pw-print-root { display: none !important; } }
@media print {
  html, body { background: #ffffff !important; }
  body > *:not(.pw-print-root) { display: none !important; }
  .pw-print-root { display: block !important; position: static !important; margin: 0; padding: 0; color: #000; }
  .pw-print-page { break-after: page; page-break-after: always; }
  .pw-print-page:last-child { break-after: auto; page-break-after: auto; }
  .pw-print-page img, .pw-print-page svg, .pw-print-page table, .pw-print-page pre { break-inside: avoid; page-break-inside: avoid; max-width: 100%; }
  .powerwiki-heading-anchor, .powerwiki-copy-code, .powerwiki-mermaid-tools { display: none !important; }
}`;

/** Renders the given pages and opens the browser print dialog to save as PDF. */
export async function exportPagesToPdf(
  pages: readonly ExportPage[],
  options: PageRenderOptions,
  onProgress?: () => void
): Promise<void> {
  const root = document.createElement("div");
  root.className = options.themeMode === "dark" ? "pw-print-root markdown-preview" : "pw-print-root markdown-preview";
  const multi = pages.length > 1;

  for (const page of pages) {
    const element = await renderPageToElement(page.content, { ...options, currentPath: page.path });
    const section = document.createElement("section");
    section.className = "pw-print-page";
    if (multi) {
      const heading = document.createElement("h1");
      heading.textContent = page.title;
      section.appendChild(heading);
    }
    while (element.firstChild) {
      section.appendChild(element.firstChild);
    }
    element.remove();
    root.appendChild(section);
    onProgress?.();
  }

  const style = document.createElement("style");
  style.id = PRINT_STYLE_ID;
  style.textContent = PRINT_CSS;
  document.head.appendChild(style);
  document.body.appendChild(root);

  const cleanup = () => {
    root.remove();
    style.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);

  // Let layout settle (images/fonts) before invoking print.
  await new Promise((resolve) => setTimeout(resolve, 150));
  try {
    window.print();
  } finally {
    // Fallback cleanup if afterprint never fires (some browsers/cancel paths).
    setTimeout(cleanup, 60000);
  }
}
