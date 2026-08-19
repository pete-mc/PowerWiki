import { useEffect, useMemo, useState } from "react";

import type { ExportImage } from "../../export/types";
import type { PageRenderOptions } from "../../export/renderPageHtml";
import type { WikiPageTreeNode } from "../../wiki/WikiPageTree";
import { ChevronIcon } from "./WikiPageIcons";

export interface ExportPageRef {
  readonly path: string;
  readonly title: string;
}

interface WikiExportDialogProps {
  readonly currentPage: ExportPageRef;
  /** Wiki page tree (lazy-loaded) for the multi-page selector. */
  readonly treeNodes: readonly WikiPageTreeNode[];
  /** Asks the host to fetch a node's children when it is expanded. */
  readonly onExpandNode: (path: string) => void;
  readonly loadPageContent: (path: string) => Promise<string>;
  /** Resolves an image reference to bytes for the Word export. */
  readonly loadImage: (src: string, pagePath: string) => Promise<ExportImage | null>;
  /** Options for rendering enriched HTML for the PDF export. */
  readonly renderOptions: PageRenderOptions;
  /** Delivers the finished file. Hosts differ; see WikiHost.saveExportedFile. */
  readonly onSaveFile: (fileName: string, blob: Blob) => Promise<void>;
  /**
   * Whether PDF export is offered. It works by printing the document, which a
   * VS Code webview cannot do, so the option is hidden rather than shown and
   * doing nothing.
   */
  readonly allowPdf: boolean;
  readonly onClose: () => void;
}

type Scope = "single" | "multi";
type Format = "word" | "pdf";

export function WikiExportDialog({
  currentPage,
  treeNodes,
  onExpandNode,
  loadPageContent,
  loadImage,
  renderOptions,
  onSaveFile,
  allowPdf,
  onClose,
}: WikiExportDialogProps) {
  const [format, setFormat] = useState<Format>("word");
  const [scope, setScope] = useState<Scope>("single");
  const [selected, setSelected] = useState<readonly string[]>([currentPage.path]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const titleByPath = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (nodes: readonly WikiPageTreeNode[]) => {
      for (const node of nodes) {
        map.set(node.path, node.name);
        walk(node.children);
      }
    };
    walk(treeNodes);
    map.set(currentPage.path, currentPage.title);
    return map;
  }, [currentPage, treeNodes]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  function toggle(path: string) {
    setSelected((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path]
    );
  }

  function move(path: string, delta: number) {
    setSelected((current) => {
      const index = current.indexOf(path);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleExport() {
    const chosen = scope === "single" ? [currentPage.path] : selected;
    if (chosen.length === 0) {
      setError("Select at least one page.");
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const exportPages = [];
      for (const path of chosen) {
        const content = await loadPageContent(path);
        exportPages.push({ path, title: titleByPath.get(path) ?? lastSegment(path), content });
      }

      if (format === "word") {
        const { exportPagesToWord } = await import("../../export/exportWord");
        const fileName =
          (exportPages.length === 1 ? sanitizeFileName(exportPages[0].title) : "PowerWiki export") + ".docx";
        await exportPagesToWord(exportPages, renderOptions, loadImage, fileName, onSaveFile);
      } else {
        const { exportPagesToPdf } = await import("../../export/exportPdf");
        await exportPagesToPdf(exportPages, renderOptions);
      }
      onClose();
    } catch (exportError: unknown) {
      setError(exportError instanceof Error ? exportError.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  const orderedSelection = scope === "multi" ? selected : [currentPage.path];

  return (
    <div className="wiki-export-overlay" onClick={() => (busy ? undefined : onClose())} role="dialog" aria-modal="true">
      <div className="wiki-export-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="wiki-export-header">
          <h2>Export</h2>
          <button aria-label="Close" className="wiki-export-close" disabled={busy} onClick={onClose} type="button">
            &times;
          </button>
        </div>

        <div className="wiki-export-scope">
          <label>
            <input checked={format === "word"} disabled={busy} onChange={() => setFormat("word")} type="radio" />
            Word (.docx)
          </label>
          {allowPdf ? (
            <label>
              <input checked={format === "pdf"} disabled={busy} onChange={() => setFormat("pdf")} type="radio" />
              PDF (print)
            </label>
          ) : null}
        </div>

        <div className="wiki-export-scope">
          <label>
            <input checked={scope === "single"} disabled={busy} onChange={() => setScope("single")} type="radio" />
            This page ({currentPage.title})
          </label>
          <label>
            <input checked={scope === "multi"} disabled={busy} onChange={() => setScope("multi")} type="radio" />
            Multiple pages
          </label>
        </div>

        {scope === "multi" ? (
          <div className="wiki-export-multi">
            <div className="wiki-export-pane">
              <div className="wiki-export-pane-title">Pages</div>
              <div className="wiki-export-list">
                <ExportTree nodes={treeNodes} onExpand={onExpandNode} onToggle={toggle} selected={selected} />
              </div>
            </div>
            <div className="wiki-export-pane">
              <div className="wiki-export-pane-title">Selected order</div>
              <div className="wiki-export-list">
                {orderedSelection.length === 0 ? (
                  <div className="wiki-export-empty">No pages selected.</div>
                ) : (
                  orderedSelection.map((path, index) => (
                    <div className="wiki-export-selected" key={path}>
                      <span className="wiki-export-item-title" title={path}>
                        {index + 1}. {titleByPath.get(path) ?? lastSegment(path)}
                      </span>
                      <span className="wiki-export-order">
                        <button disabled={busy || index === 0} onClick={() => move(path, -1)} title="Move up" type="button">↑</button>
                        <button disabled={busy || index === orderedSelection.length - 1} onClick={() => move(path, 1)} title="Move down" type="button">↓</button>
                        <button disabled={busy} onClick={() => toggle(path)} title="Remove" type="button">✕</button>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}

        {error ? <p className="wiki-export-error" role="alert">{error}</p> : null}

        <div className="wiki-export-actions">
          <span className="wiki-export-note">
            Markdown, tables, work items, and Mermaid are rendered.
            {format === "word" ? " Headings become Word heading styles." : " Opens the browser print dialog."}
          </span>
          <button disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button className="wiki-export-primary" disabled={busy} onClick={() => void handleExport()} type="button">
            {busy ? "Exporting…" : format === "word" ? "Export Word" : "Export PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ExportTreeProps {
  readonly nodes: readonly WikiPageTreeNode[];
  readonly selected: readonly string[];
  readonly onToggle: (path: string) => void;
  readonly onExpand: (path: string) => void;
}

function ExportTree({ nodes, selected, onToggle, onExpand }: ExportTreeProps) {
  if (nodes.length === 0) {
    return <div className="wiki-export-empty">No pages found.</div>;
  }
  return (
    <ul className="wiki-export-tree">
      {nodes.map((node) => (
        <ExportTreeItem key={node.path} node={node} onExpand={onExpand} onToggle={onToggle} selected={selected} />
      ))}
    </ul>
  );
}

function ExportTreeItem({ node, selected, onToggle, onExpand }: { node: WikiPageTreeNode } & Omit<ExportTreeProps, "nodes">) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (expanded && node.hasChildren && !node.childrenLoaded) {
      onExpand(node.path);
    }
  }, [expanded, node.childrenLoaded, node.hasChildren, node.path, onExpand]);

  return (
    <li>
      <div className="wiki-export-tree-row">
        <button
          aria-label={node.hasChildren ? (expanded ? `Collapse ${node.name}` : `Expand ${node.name}`) : undefined}
          className="wiki-export-tree-toggle"
          disabled={!node.hasChildren}
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {node.hasChildren ? <ChevronIcon className={expanded ? "expanded" : undefined} /> : null}
        </button>
        <label className="wiki-export-item" title={node.path}>
          <input checked={selected.includes(node.path)} onChange={() => onToggle(node.path)} type="checkbox" />
          <span className="wiki-export-item-title">{node.name}</span>
        </label>
      </div>
      {expanded && node.hasChildren && !node.childrenLoaded ? (
        <p className="wiki-export-tree-loading">Loading…</p>
      ) : null}
      {expanded && node.children.length > 0 ? (
        <ExportTree nodes={node.children} onExpand={onExpand} onToggle={onToggle} selected={selected} />
      ) : null}
    </li>
  );
}

function lastSegment(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : "PowerWiki page";
}
