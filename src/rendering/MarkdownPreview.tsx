import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useThemeMode } from "../app/themeMode";
import { TOSP_PLACEHOLDER_ATTR, TOSP_PLACEHOLDER_VALUE } from "./adoPlaceholdersPlugin";
import { QUERY_TABLE_ATTR, QUERY_TABLE_SELECTOR, WORK_ITEM_ATTR, WORK_ITEM_SELECTOR } from "./adoWorkItemsPlugin";
import { createMarkdownRenderer } from "./createMarkdownRenderer";
import { addCopyButtons, highlightCodeBlocks } from "./enhancePreview";
import { renderMath } from "./mathRender";
import { MermaidZoomOverlay } from "./MermaidZoomOverlay";
import { addMermaidToolbars, downloadMermaidPng, downloadMermaidSvg } from "./mermaidTools";
import { renderMermaidDiagrams } from "./renderMermaidDiagrams";
import { sanitizeRenderedHtml } from "./sanitizeRenderedHtml";

/** A direct child of the current page, used to fill the [[_TOSP_]] placeholder. */
export interface WikiSubPage {
  readonly path: string;
  readonly title: string;
}

export interface QueryTableColumn {
  readonly name: string;
  readonly referenceName: string;
}

export interface QueryTableRow {
  readonly id: number;
  readonly values: ReadonlyMap<string, string>;
}

export interface QueryTableResult {
  readonly columns: readonly QueryTableColumn[];
  readonly name?: string;
  readonly nativeUrl?: string;
  readonly rows: readonly QueryTableRow[];
}

export interface WorkItemBadgeDetails {
  readonly id: number;
  readonly state?: string;
  readonly title?: string;
  readonly type?: string;
}

interface MarkdownPreviewProps {
  readonly markdown: string;
  /** Wiki path of the page being rendered; used to resolve relative links. */
  readonly currentPath?: string;
  /** Direct child pages, rendered where a [[_TOSP_]] placeholder appears. */
  readonly subPages?: readonly WikiSubPage[];
  /** Resolves rendered image sources before the HTML is inserted into the DOM. */
  readonly onResolveImageSrc?: (src: string, currentPath: string) => string | undefined;
  /** Loads an embedded Azure Boards query table. */
  readonly onLoadQueryTable?: (queryId: string) => Promise<QueryTableResult>;
  /** Called when an internal wiki link is clicked, with the resolved wiki path. */
  readonly onNavigate?: (path: string) => void;
  /** Opens the native Azure DevOps work item UI. */
  readonly onOpenWorkItem?: (id: number) => void;
  /** Loads details used to enrich inline work item badges. */
  readonly onLoadWorkItemBadge?: (id: number) => Promise<WorkItemBadgeDetails>;
}

const TOSP_PLACEHOLDER_SELECTOR = `[${TOSP_PLACEHOLDER_ATTR}="${TOSP_PLACEHOLDER_VALUE}"]`;

const markdownRenderer = createMarkdownRenderer();

// Matches any URI scheme (http:, https:, mailto:, tel:, etc.).
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Resolves an in-page link href to an absolute wiki page path.
 *
 * Returns null for links that should be left to default browser handling
 * (external URLs with a scheme, protocol-relative URLs, and pure fragments).
 *
 * Relative links resolve against the current page path using standard URL
 * semantics (e.g. from "/A/B", "C" -> "/A/C", "../D" -> "/D").
 */
function resolveInternalPath(href: string, currentPath: string): string | null {
  if (!href || href.startsWith("#") || href.startsWith("//") || HAS_SCHEME.test(href)) {
    return null;
  }

  try {
    const base = "http://wiki" + encodeURI(currentPath.startsWith("/") ? currentPath : `/${currentPath}`);
    const resolved = new URL(href, base);
    return safeDecode(resolved.pathname);
  } catch {
    return null;
  }
}

export function MarkdownPreview({
  markdown,
  currentPath,
  subPages,
  onLoadQueryTable,
  onLoadWorkItemBadge,
  onNavigate,
  onOpenWorkItem,
  onResolveImageSrc
}: MarkdownPreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const queryCacheRef = useRef(new Map<string, QueryTableResult>());
  const queryErrorCacheRef = useRef(new Map<string, string>());
  const queryInFlightRef = useRef(new Set<string>());
  const workItemCacheRef = useRef(new Map<number, WorkItemBadgeDetails>());
  const workItemInFlightRef = useRef(new Set<number>());
  const workItemFailedRef = useRef(new Set<number>());
  const mountedRef = useRef(true);
  // Tracks the base HTML currently written into the container so enrichment
  // re-runs (an async result arriving, a subpage list changing, a theme change)
  // don't needlessly wipe and rebuild the already-enriched DOM.
  const renderedHtmlRef = useRef<string | undefined>(undefined);
  // Bumped whenever an async enrichment result arrives so the enrichment effect
  // re-runs and re-applies the now-cached result to the current DOM nodes.
  const [enrichmentVersion, setEnrichmentVersion] = useState(0);
  // The image currently shown in the click-to-zoom lightbox, if any.
  const [lightboxSrc, setLightboxSrc] = useState<string | undefined>(undefined);
  // Serialized SVG of the Mermaid diagram open in the pan/zoom overlay, if any.
  const [mermaidZoom, setMermaidZoom] = useState<string | undefined>(undefined);
  const themeMode = useThemeMode();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const bumpEnrichment = useCallback(() => {
    if (mountedRef.current) {
      setEnrichmentVersion((version) => version + 1);
    }
  }, []);
  const html = useMemo(() => {
    const sanitizedHtml = sanitizeRenderedHtml(markdownRenderer.render(markdown));
    return currentPath && onResolveImageSrc
      ? resolveImageSources(sanitizedHtml, currentPath, onResolveImageSrc)
      : sanitizedHtml;
  }, [currentPath, markdown, onResolveImageSrc]);

  // PowerWiki owns the preview container's DOM directly rather than handing it
  // to React through dangerouslySetInnerHTML. React only ever sees an empty
  // <div>, so it can never rewrite the subtree during an unrelated re-render and
  // wipe the query/work-item enrichment layered on top of the base HTML — the
  // race that previously left placeholders stuck as "Loading query."/plain "#N"
  // after navigating between pages or resizing the split editor.
  //
  // Everything runs in one layout effect, before the browser paints, so the
  // base HTML is written and cache-hit enrichment applied atomically with no
  // window where a raw placeholder is visible or unprocessed. The effect also
  // re-runs on an enrichmentVersion bump to fold in async results, re-querying
  // the live container each time so it self-heals after any rebuild.
  useLayoutEffect(() => {
    const container = previewRef.current;
    if (!container) {
      return;
    }

    // Rebuild the base HTML only when it actually changed. On an enrichment
    // re-run (same html, new async data) we keep the existing nodes and simply
    // re-apply enrichment, which is idempotent.
    if (renderedHtmlRef.current !== html) {
      container.innerHTML = html;
      renderedHtmlRef.current = html;
    }

    fillSubPagePlaceholders(container, subPages);
    enrichQueryTables(container, {
      cache: queryCacheRef.current,
      errorCache: queryErrorCacheRef.current,
      inFlight: queryInFlightRef.current,
      onLoadQueryTable,
      onSettled: bumpEnrichment,
    });
    enrichWorkItemBadges(container, {
      cache: workItemCacheRef.current,
      failed: workItemFailedRef.current,
      inFlight: workItemInFlightRef.current,
      onLoadWorkItemBadge,
      onSettled: bumpEnrichment,
    });
    addCopyButtons(container);
    void highlightCodeBlocks(container);
    void renderMath(container);
  }, [bumpEnrichment, enrichmentVersion, html, onLoadQueryTable, onLoadWorkItemBadge, subPages]);

  // Close the image lightbox on Escape.
  useEffect(() => {
    if (!lightboxSrc) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLightboxSrc(undefined);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [lightboxSrc]);

  // Mermaid runs in its own layout effect (after the one above, by declaration
  // order) so a host theme change re-renders diagrams without disturbing the
  // query/work-item enrichment.
  useLayoutEffect(() => {
    const container = previewRef.current;
    if (!container) {
      return;
    }

    void renderMermaidDiagrams(container, themeMode).then(() => {
      addMermaidToolbars(container);
    });
  }, [html, themeMode]);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    // Ignore modified clicks so users can still open links in a new tab.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const mermaidButton = (event.target as HTMLElement).closest<HTMLElement>("[data-mermaid-action]");
    if (mermaidButton) {
      event.preventDefault();
      const svg = mermaidButton.closest("pre")?.querySelector("svg");
      const action = mermaidButton.getAttribute("data-mermaid-action");
      if (svg) {
        if (action === "zoom") {
          setMermaidZoom(svg.outerHTML);
        } else if (action === "svg") {
          downloadMermaidSvg(svg);
        } else if (action === "png") {
          downloadMermaidPng(svg);
        }
      }
      return;
    }

    const copyButton = (event.target as HTMLElement).closest<HTMLButtonElement>(".powerwiki-copy-code");
    if (copyButton) {
      event.preventDefault();
      const code = copyButton.closest("pre")?.querySelector("code");
      if (code && navigator.clipboard) {
        void navigator.clipboard
          .writeText(code.textContent ?? "")
          .then(() => {
            copyButton.textContent = "Copied";
            window.setTimeout(() => {
              copyButton.textContent = "Copy";
            }, 1500);
          })
          .catch(() => {});
      }
      return;
    }

    // Click a content image (not one that is itself a link) to zoom it.
    const image = (event.target as HTMLElement).closest<HTMLImageElement>("img");
    if (image && !image.closest("a")) {
      event.preventDefault();
      setLightboxSrc(image.currentSrc || image.src);
      return;
    }

    const workItemLink = (event.target as HTMLElement).closest<HTMLElement>(WORK_ITEM_SELECTOR);
    const workItemId = workItemLink ? Number(workItemLink.getAttribute(WORK_ITEM_ATTR)) : 0;
    if (workItemId > 0 && onOpenWorkItem) {
      event.preventDefault();
      onOpenWorkItem(workItemId);
      return;
    }

    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor) {
      return;
    }

    const href = anchor.getAttribute("href");
    if (!href) {
      return;
    }

    // External links: open in a new tab (the extension runs inside an iframe).
    if (HAS_SCHEME.test(href) || href.startsWith("//")) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
      return;
    }

    const targetPath = currentPath ? resolveInternalPath(href, currentPath) : null;
    if (targetPath && onNavigate) {
      event.preventDefault();
      onNavigate(targetPath);
    }
  }

  return (
    <>
      <div
        className={themeMode === "dark" ? "markdown-preview pw-dark" : "markdown-preview"}
        onClick={handleClick}
        ref={previewRef}
      />
      {lightboxSrc ? (
        <div
          aria-modal="true"
          className="powerwiki-lightbox"
          onClick={() => setLightboxSrc(undefined)}
          role="dialog"
        >
          <img alt="" src={lightboxSrc} />
        </div>
      ) : null}
      {mermaidZoom ? (
        <MermaidZoomOverlay onClose={() => setMermaidZoom(undefined)} svgHtml={mermaidZoom} />
      ) : null}
    </>
  );
}

interface QueryEnrichmentContext {
  readonly cache: Map<string, QueryTableResult>;
  readonly errorCache: Map<string, string>;
  readonly inFlight: Set<string>;
  readonly onLoadQueryTable?: (queryId: string) => Promise<QueryTableResult>;
  readonly onSettled: () => void;
}

interface WorkItemEnrichmentContext {
  readonly cache: Map<number, WorkItemBadgeDetails>;
  readonly failed: Set<number>;
  readonly inFlight: Set<number>;
  readonly onLoadWorkItemBadge?: (id: number) => Promise<WorkItemBadgeDetails>;
  readonly onSettled: () => void;
}

/** Fills every [[_TOSP_]] table-of-subpages placeholder in the container. */
function fillSubPagePlaceholders(container: HTMLElement, subPages: readonly WikiSubPage[] | undefined): void {
  const placeholders = Array.from(container.querySelectorAll(TOSP_PLACEHOLDER_SELECTOR));
  for (const placeholder of placeholders) {
    placeholder.replaceChildren();

    if (!subPages || subPages.length === 0) {
      const empty = document.createElement("p");
      empty.className = "powerwiki-subpages-empty";
      empty.textContent = "No subpages.";
      placeholder.appendChild(empty);
      continue;
    }

    const list = document.createElement("ul");
    for (const subPage of subPages) {
      const item = document.createElement("li");
      const anchor = document.createElement("a");
      // Absolute wiki path; handleClick resolves it to an in-app navigation.
      anchor.setAttribute("href", encodeURI(subPage.path));
      anchor.textContent = subPage.title;
      item.appendChild(anchor);
      list.appendChild(item);
    }
    placeholder.appendChild(list);
  }
}

/**
 * Applies cached query results (or kicks off a single load per query id) to
 * every query-table placeholder currently in the container. Safe to call
 * repeatedly: it re-queries the live DOM and only starts a load when there is
 * no cached result, error, or in-flight request for that query.
 */
function enrichQueryTables(container: HTMLElement, ctx: QueryEnrichmentContext): void {
  const queryTables = Array.from(container.querySelectorAll<HTMLElement>(QUERY_TABLE_SELECTOR));
  for (const queryTable of queryTables) {
    const queryId = queryTable.getAttribute(QUERY_TABLE_ATTR);
    if (!queryId) {
      continue;
    }

    const cachedResult = ctx.cache.get(queryId);
    if (cachedResult) {
      renderQueryResult(queryTable, cachedResult);
      continue;
    }

    const cachedError = ctx.errorCache.get(queryId);
    if (cachedError) {
      renderQueryMessage(queryTable, cachedError);
      continue;
    }

    renderQueryLoading(queryTable, queryId);

    const load = ctx.onLoadQueryTable;
    if (!load) {
      const unavailable = "Azure Boards query rendering is unavailable.";
      ctx.errorCache.set(queryId, unavailable);
      renderQueryMessage(queryTable, unavailable);
      continue;
    }

    // Only one in-flight request per query id; the settled callback re-runs
    // enrichment and paints the cached result on the current node.
    if (ctx.inFlight.has(queryId)) {
      continue;
    }
    ctx.inFlight.add(queryId);
    void load(queryId)
      .then((result) => {
        ctx.cache.set(queryId, result);
        ctx.errorCache.delete(queryId);
      })
      .catch((error: unknown) => {
        ctx.errorCache.set(queryId, formatQueryError(error));
      })
      .finally(() => {
        ctx.inFlight.delete(queryId);
        ctx.onSettled();
      });
  }
}

/**
 * Enriches every inline work-item badge in the container with the work item's
 * type/title/state, loading details once per id. Badges keep opening the native
 * work item form even when enrichment fails, so a failed load leaves the basic
 * badge in place and is not retried.
 */
function enrichWorkItemBadges(container: HTMLElement, ctx: WorkItemEnrichmentContext): void {
  const badges = Array.from(container.querySelectorAll<HTMLElement>(WORK_ITEM_SELECTOR));
  for (const badge of badges) {
    const id = Number(badge.getAttribute(WORK_ITEM_ATTR));
    if (!Number.isInteger(id) || id <= 0) {
      continue;
    }

    const cachedBadge = ctx.cache.get(id);
    if (cachedBadge) {
      renderWorkItemBadge(badge, cachedBadge);
      continue;
    }

    renderWorkItemBadge(badge, { id });

    const load = ctx.onLoadWorkItemBadge;
    if (!load || ctx.failed.has(id) || ctx.inFlight.has(id)) {
      continue;
    }
    ctx.inFlight.add(id);
    void load(id)
      .then((details) => {
        ctx.cache.set(id, details);
      })
      .catch(() => {
        ctx.failed.add(id);
      })
      .finally(() => {
        ctx.inFlight.delete(id);
        ctx.onSettled();
      });
  }
}

function renderQueryLoading(container: HTMLElement, queryId: string): void {
  container.replaceChildren();
  container.classList.remove("powerwiki-query-table-error");

  const message = document.createElement("p");
  message.className = "powerwiki-query-table-status";
  message.textContent = `Loading query ${queryId}.`;
  container.appendChild(message);
}

function renderQueryMessage(container: HTMLElement, message: string): void {
  container.replaceChildren();
  container.classList.add("powerwiki-query-table-error");

  const paragraph = document.createElement("p");
  paragraph.className = "powerwiki-query-table-status";
  paragraph.textContent = message;
  container.appendChild(paragraph);
}

function renderQueryResult(container: HTMLElement, result: QueryTableResult): void {
  container.replaceChildren();
  container.classList.remove("powerwiki-query-table-error");

  const header = document.createElement("div");
  header.className = "powerwiki-query-table-header";

  const title = document.createElement("strong");
  title.textContent = result.name ?? "Azure Boards query";
  header.appendChild(title);

  const count = document.createElement("span");
  count.textContent = `${result.rows.length} item${result.rows.length === 1 ? "" : "s"}`;
  header.appendChild(count);

  if (result.nativeUrl) {
    const nativeLink = document.createElement("a");
    nativeLink.href = result.nativeUrl;
    nativeLink.rel = "noopener noreferrer";
    nativeLink.target = "_blank";
    nativeLink.textContent = "Open in Azure DevOps";
    header.appendChild(nativeLink);
  }

  container.appendChild(header);

  if (result.rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "powerwiki-query-table-status";
    empty.textContent = "No work items matched this query.";
    container.appendChild(empty);
    return;
  }

  const scroller = document.createElement("div");
  scroller.className = "powerwiki-query-table-scroll";
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");

  for (const column of result.columns) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = column.name;
    headRow.appendChild(cell);
  }

  head.appendChild(headRow);
  table.appendChild(head);

  const body = document.createElement("tbody");
  for (const row of result.rows) {
    const tableRow = document.createElement("tr");

    for (const column of result.columns) {
      const cell = document.createElement("td");
      const value = row.values.get(column.referenceName) ?? "";

      if (column.referenceName === "System.Id") {
        const link = document.createElement("a");
        link.href = "#";
        link.className = "powerwiki-work-item-badge";
        link.setAttribute(WORK_ITEM_ATTR, String(row.id));
        link.title = `Open work item ${row.id}`;
        link.textContent = value || String(row.id);
        cell.appendChild(link);
      } else {
        cell.textContent = value;
      }

      tableRow.appendChild(cell);
    }

    body.appendChild(tableRow);
  }

  table.appendChild(body);
  scroller.appendChild(table);
  container.appendChild(scroller);
}

function renderWorkItemBadge(badge: HTMLElement, details: WorkItemBadgeDetails): void {
  const titleParts = [
    details.type,
    `#${details.id}`,
    details.title,
    details.state ? `(${details.state})` : undefined
  ].filter(Boolean);

  badge.title = titleParts.join(" ");
  badge.replaceChildren();
  badge.classList.add("powerwiki-work-item-badge-rich");
  badge.style.setProperty("--pw-work-item-type-color", workItemTypeColor(details.type));

  const marker = document.createElement("span");
  marker.className = "powerwiki-work-item-type-marker";
  marker.setAttribute("aria-hidden", "true");
  badge.appendChild(marker);

  const id = document.createElement("span");
  id.className = "powerwiki-work-item-id";
  id.textContent = String(details.id);
  badge.appendChild(id);

  if (details.title) {
    const title = document.createElement("span");
    title.className = "powerwiki-work-item-title";
    title.textContent = details.title;
    badge.appendChild(title);
  }

  if (details.state) {
    badge.setAttribute("data-powerwiki-work-item-state", details.state);

    const state = document.createElement("span");
    state.className = "powerwiki-work-item-state";

    const stateDot = document.createElement("span");
    stateDot.className = "powerwiki-work-item-state-dot";
    stateDot.setAttribute("aria-hidden", "true");
    state.appendChild(stateDot);
    state.appendChild(document.createTextNode(details.state));
    badge.appendChild(state);
  }
}

function workItemTypeColor(type: string | undefined): string {
  switch (type?.trim().toLowerCase()) {
    case "issue":
      return "#107c10";
    case "bug":
      return "#cc293d";
    case "task":
      return "#0078d4";
    case "user story":
      return "#773b93";
    case "feature":
      return "#773b93";
    case "epic":
      return "#ff7b00";
    default:
      return "#0078d4";
  }
}

function formatQueryError(error: unknown): string {
  if (error instanceof Error) {
    return `Unable to load query: ${error.message}`;
  }

  return "Unable to load query.";
}

function resolveImageSources(
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

    const resolvedSrc = resolveImageSrc(src, currentPath);
    if (resolvedSrc) {
      image.setAttribute("src", resolvedSrc);
    }
  }

  return template.innerHTML;
}
