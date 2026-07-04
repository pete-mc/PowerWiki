import { useEffect, useMemo, useState } from "react";

import type { ExportImage } from "../../export/markdownToDocx";

export interface ExportPageRef {
  readonly path: string;
  readonly title: string;
}

interface WikiExportDialogProps {
  readonly currentPage: ExportPageRef;
  readonly pages: readonly ExportPageRef[];
  readonly loadPageContent: (path: string) => Promise<string>;
  readonly loadImage: (src: string, pagePath: string) => Promise<ExportImage | null>;
  readonly onClose: () => void;
}

type Scope = "single" | "multi";

export function WikiExportDialog({ currentPage, pages, loadPageContent, loadImage, onClose }: WikiExportDialogProps) {
  const [scope, setScope] = useState<Scope>("single");
  const [selected, setSelected] = useState<readonly string[]>([currentPage.path]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const titleByPath = useMemo(() => {
    const map = new Map<string, string>();
    for (const page of pages) {
      map.set(page.path, page.title);
    }
    map.set(currentPage.path, currentPage.title);
    return map;
  }, [currentPage, pages]);

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
        exportPages.push({ path, title: titleByPath.get(path) ?? path, content });
      }

      const { exportPagesToWord } = await import("../../export/exportWord");
      const fileName =
        (exportPages.length === 1 ? sanitizeFileName(exportPages[0].title) : "PowerWiki export") + ".docx";
      await exportPagesToWord(exportPages, loadImage, fileName);
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
          <h2>Export to Word</h2>
          <button aria-label="Close" className="wiki-export-close" disabled={busy} onClick={onClose} type="button">
            &times;
          </button>
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
                {pages.map((page) => (
                  <label className="wiki-export-item" key={page.path} title={page.path}>
                    <input
                      checked={selected.includes(page.path)}
                      disabled={busy}
                      onChange={() => toggle(page.path)}
                      type="checkbox"
                    />
                    <span className="wiki-export-item-title">{page.title}</span>
                  </label>
                ))}
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
                        {index + 1}. {titleByPath.get(path) ?? path}
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
          <span className="wiki-export-note">Markdown and Mermaid are rendered; headings become Word heading styles.</span>
          <button disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button className="wiki-export-primary" disabled={busy} onClick={() => void handleExport()} type="button">
            {busy ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : "PowerWiki page";
}
