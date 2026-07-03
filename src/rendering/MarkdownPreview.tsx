import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { useThemeMode } from "../app/themeMode";
import { TOSP_PLACEHOLDER_ATTR, TOSP_PLACEHOLDER_VALUE } from "./adoPlaceholdersPlugin";
import { QUERY_TABLE_ATTR, QUERY_TABLE_SELECTOR, WORK_ITEM_ATTR, WORK_ITEM_SELECTOR } from "./adoWorkItemsPlugin";
import { createMarkdownRenderer } from "./createMarkdownRenderer";
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
  const themeMode = useThemeMode();
  const renderMermaidInPreview = useCallback(() => {
    const container = previewRef.current;
    if (!container) {
      return;
    }

    void renderMermaidDiagrams(container, themeMode);
  }, [themeMode]);
  const html = useMemo(() => {
    const sanitizedHtml = sanitizeRenderedHtml(markdownRenderer.render(markdown));
    return currentPath && onResolveImageSrc
      ? resolveImageSources(sanitizedHtml, currentPath, onResolveImageSrc)
      : sanitizedHtml;
  }, [currentPath, markdown, onResolveImageSrc]);

  useLayoutEffect(() => {
    let cancelled = false;
    let animationFrame = 0;

    const renderDiagrams = () => {
      if (cancelled) {
        return;
      }

      renderMermaidInPreview();
    };

    renderDiagrams();
    animationFrame = window.requestAnimationFrame(renderDiagrams);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
    };
  }, [html, renderMermaidInPreview]);

  useEffect(() => {
    const container = previewRef.current;
    if (!container) {
      return;
    }

    let timeout = 0;
    const scheduleRender = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(renderMermaidInPreview, 0);
    };

    scheduleRender();
    const observer = new MutationObserver(scheduleRender);
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      window.clearTimeout(timeout);
      observer.disconnect();
    };
  }, [html, renderMermaidInPreview]);

  useEffect(() => {
    const container = previewRef.current;
    if (!container) {
      return;
    }

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
  }, [html, subPages]);

  useEffect(() => {
    const container = previewRef.current;
    if (!container) {
      return;
    }

    let cancelled = false;
    const queryTables = Array.from(container.querySelectorAll<HTMLElement>(QUERY_TABLE_SELECTOR));

    for (const queryTable of queryTables) {
      const queryId = queryTable.getAttribute(QUERY_TABLE_ATTR);
      if (!queryId) {
        continue;
      }

      renderQueryLoading(queryTable, queryId);

      if (!onLoadQueryTable) {
        renderQueryMessage(queryTable, "Azure Boards query rendering is unavailable.");
        continue;
      }

      void onLoadQueryTable(queryId)
        .then((result) => {
          if (!cancelled) {
            renderQueryResult(queryTable, result);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            renderQueryMessage(queryTable, formatQueryError(error));
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [html, onLoadQueryTable]);

  useEffect(() => {
    const container = previewRef.current;
    if (!container || !onLoadWorkItemBadge) {
      return;
    }

    let cancelled = false;
    const badges = Array.from(container.querySelectorAll<HTMLElement>(WORK_ITEM_SELECTOR));

    for (const badge of badges) {
      const id = Number(badge.getAttribute(WORK_ITEM_ATTR));
      if (!Number.isInteger(id) || id <= 0) {
        continue;
      }

      void onLoadWorkItemBadge(id)
        .then((details) => {
          if (!cancelled) {
            enrichWorkItemBadge(badge, details);
          }
        })
        .catch(() => {
          // The badge still opens the native form; enrichment is best-effort.
        });
    }

    return () => {
      cancelled = true;
    };
  }, [html, onLoadWorkItemBadge]);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    // Ignore modified clicks so users can still open links in a new tab.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
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
    <div
      className="markdown-preview"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={handleClick}
      ref={previewRef}
      // Remount on theme change so already-rendered Mermaid diagrams are
      // regenerated with the matching light/dark Mermaid theme.
      key={`${themeMode}\n${html}`}
    />
  );
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

function enrichWorkItemBadge(badge: HTMLElement, details: WorkItemBadgeDetails): void {
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
