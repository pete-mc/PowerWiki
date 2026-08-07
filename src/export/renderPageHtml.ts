// Renders a wiki page's Markdown to a fully enriched, detached DOM element — the
// same pipeline the live preview uses, so exports get query tables, work-item
// badges, embedded HTML, Mermaid (as inline SVG), math, and highlighted code.
// Used by both the PDF (print) and Word (html -> docx) export paths.

import { MENTION_ATTR, MENTION_SELECTOR } from "../rendering/adoMentionsPlugin";
import { QUERY_TABLE_ATTR, QUERY_TABLE_SELECTOR, WORK_ITEM_ATTR, WORK_ITEM_SELECTOR } from "../rendering/adoWorkItemsPlugin";
import { createMarkdownRenderer } from "../rendering/createMarkdownRenderer";
import { highlightCodeBlocks } from "../rendering/enhancePreview";
import {
  renderMention,
  renderQueryMessage,
  renderQueryResult,
  renderWorkItemBadge,
  type MentionIdentity,
  type QueryTableResult,
  type WorkItemBadgeDetails,
} from "../rendering/MarkdownPreview";
import { renderMath } from "../rendering/mathRender";
import { renderMermaidDiagrams } from "../rendering/renderMermaidDiagrams";
import { sanitizeRenderedHtml } from "../rendering/sanitizeRenderedHtml";
import type { ThemeMode } from "../app/themeMode";

export interface RenderPageOptions {
  readonly currentPath: string;
  readonly themeMode: ThemeMode;
  /**
   * Render Mermaid labels as SVG <text> instead of HTML in a <foreignObject>.
   * The Word export sets this: an SVG containing a <foreignObject> taints the
   * canvas it is rasterized through, so those diagrams cannot become images and
   * would land in the document as a placeholder. Print/PDF keeps the richer HTML
   * labels because it embeds the SVG directly.
   */
  readonly plainDiagramLabels?: boolean;
  readonly resolveImageSrc?: (src: string, currentPath: string) => string | undefined;
  readonly loadQueryTable?: (queryId: string) => Promise<QueryTableResult>;
  readonly loadWorkItemBadge?: (id: number) => Promise<WorkItemBadgeDetails>;
  readonly loadMention?: (id: string) => Promise<MentionIdentity>;
}

/** Render options without the per-page path (supplied per page by the exporter). */
export type PageRenderOptions = Omit<RenderPageOptions, "currentPath">;

const renderer = createMarkdownRenderer();

/**
 * Renders Markdown to an enriched DOM element attached offscreen (Mermaid needs
 * layout to measure). The caller must call element.remove() when finished.
 */
export async function renderPageToElement(markdown: string, options: RenderPageOptions): Promise<HTMLElement> {
  let html = sanitizeRenderedHtml(renderer.render(markdown));
  if (options.resolveImageSrc) {
    html = rewriteImageSources(html, options.currentPath, options.resolveImageSrc);
  }

  const container = document.createElement("div");
  container.className = options.themeMode === "dark" ? "markdown-preview pw-dark" : "markdown-preview";
  container.innerHTML = html;
  container.style.position = "fixed";
  container.style.left = "-100000px";
  container.style.top = "0";
  container.style.width = "780px";
  document.body.appendChild(container);

  await enrichQueryTables(container, options.loadQueryTable);
  await enrichWorkItemBadges(container, options.loadWorkItemBadge);
  await enrichMentions(container, options.loadMention);
  await renderMermaidDiagrams(container, options.themeMode, {
    htmlLabels: !options.plainDiagramLabels,
  });
  await renderMath(container);
  await highlightCodeBlocks(container);

  // Interactive-only affordances have no place in an exported document.
  container
    .querySelectorAll(".powerwiki-heading-anchor, .powerwiki-copy-code, .powerwiki-mermaid-tools")
    .forEach((node) => node.remove());

  return container;
}

async function enrichQueryTables(
  container: HTMLElement,
  load: RenderPageOptions["loadQueryTable"]
): Promise<void> {
  for (const element of Array.from(container.querySelectorAll<HTMLElement>(QUERY_TABLE_SELECTOR))) {
    const queryId = element.getAttribute(QUERY_TABLE_ATTR);
    if (!queryId) {
      continue;
    }
    if (!load) {
      renderQueryMessage(element, "Azure Boards query rendering is unavailable.");
      continue;
    }
    try {
      // Export is static: render the full tree expanded so nothing is hidden.
      renderQueryResult(element, await load(queryId), { initiallyCollapsed: false });
    } catch {
      renderQueryMessage(element, "Unable to load query.");
    }
  }
}

async function enrichWorkItemBadges(
  container: HTMLElement,
  load: RenderPageOptions["loadWorkItemBadge"]
): Promise<void> {
  // Query-table id and title links carry the work-item id but stay plain; skip them.
  const badges = Array.from(
    container.querySelectorAll<HTMLElement>(
      `${WORK_ITEM_SELECTOR}:not(.powerwiki-query-id-link):not(.powerwiki-query-title-link)`
    )
  );
  for (const badge of badges) {
    const id = Number(badge.getAttribute(WORK_ITEM_ATTR));
    if (!Number.isInteger(id) || id <= 0) {
      continue;
    }
    renderWorkItemBadge(badge, { id });
    if (!load) {
      continue;
    }
    try {
      renderWorkItemBadge(badge, await load(id));
    } catch {
      // Keep the basic badge if details can't be loaded.
    }
  }
}

async function enrichMentions(
  container: HTMLElement,
  load: RenderPageOptions["loadMention"]
): Promise<void> {
  // One lookup per distinct identity, so a page that mentions the same person
  // repeatedly doesn't re-query the host for each occurrence.
  const resolved = new Map<string, MentionIdentity | undefined>();

  for (const element of Array.from(container.querySelectorAll<HTMLElement>(MENTION_SELECTOR))) {
    const id = element.getAttribute(MENTION_ATTR);
    if (!id) {
      continue;
    }

    if (!resolved.has(id)) {
      try {
        resolved.set(id, load ? await load(id) : undefined);
      } catch {
        resolved.set(id, undefined);
      }
    }

    renderMention(element, resolved.get(id));
  }
}

function rewriteImageSources(
  html: string,
  currentPath: string,
  resolveImageSrc: (src: string, currentPath: string) => string | undefined
): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const image of Array.from(template.content.querySelectorAll("img"))) {
    const src = image.getAttribute("src");
    if (!src) {
      continue;
    }
    // Keep the original wiki src for the Word export (its Git-client image fetch
    // needs the wiki path, not the resolved display URL used for PDF/print).
    image.setAttribute("data-export-src", src);
    const resolved = resolveImageSrc(src, currentPath);
    if (resolved) {
      image.setAttribute("src", resolved);
    }
  }
  return template.innerHTML;
}
