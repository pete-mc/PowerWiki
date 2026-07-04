import { useCallback, useEffect, useRef, useState } from "react";

import type * as Monaco from "monaco-editor";

import { useThemeMode } from "../themeMode";
import type { WikiPageRevision } from "../../wiki/WikiComment";
import { loadMonaco } from "./monacoLoader";

interface WikiHistoryDialogProps {
  readonly pageTitle: string;
  /** The page's current (saved) Markdown, used for "compare to current". */
  readonly currentContent: string;
  readonly loadRevisions: () => Promise<readonly WikiPageRevision[]>;
  readonly loadContentAt: (revision: WikiPageRevision) => Promise<string>;
  /** Opens the editor with the given (historical) content as the draft. */
  readonly onRestore: (content: string) => void;
  readonly onClose: () => void;
}

type CompareTo = "previous" | "current";

/**
 * Page history: lists the Git revisions of a page and shows a Monaco diff of
 * the selected revision (against its previous revision, or against the current
 * page), with a restore action that opens the editor pre-filled with the old
 * content so the user saves it through the normal path.
 */
export function WikiHistoryDialog({
  pageTitle,
  currentContent,
  loadRevisions,
  loadContentAt,
  onRestore,
  onClose,
}: WikiHistoryDialogProps) {
  const [revisions, setRevisions] = useState<readonly WikiPageRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [compareTo, setCompareTo] = useState<CompareTo>("previous");
  const [diffLoading, setDiffLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const diffContainerRef = useRef<HTMLDivElement>(null);
  const diffEditorRef = useRef<Monaco.editor.IStandaloneDiffEditor | undefined>(undefined);
  const monacoRef = useRef<typeof Monaco | undefined>(undefined);
  const contentCacheRef = useRef(new Map<string, string>());
  const requestSequenceRef = useRef(0);
  const themeMode = useThemeMode();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Load the revision list once.
  useEffect(() => {
    let cancelled = false;
    loadRevisions()
      .then((loaded) => {
        if (!cancelled) {
          setRevisions(loaded);
          setError(loaded.length === 0 ? "No revision history was found for this page." : undefined);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load history.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadRevisions]);

  const contentFor = useCallback(
    async (revision: WikiPageRevision): Promise<string> => {
      const cached = contentCacheRef.current.get(revision.commitId);
      if (cached !== undefined) {
        return cached;
      }
      const content = await loadContentAt(revision);
      contentCacheRef.current.set(revision.commitId, content);
      return content;
    },
    [loadContentAt]
  );

  // Render/refresh the diff whenever the selection or compare mode changes.
  useEffect(() => {
    if (loading || revisions.length === 0) {
      return;
    }

    const revision = revisions[selectedIndex];
    if (!revision) {
      return;
    }

    const sequence = ++requestSequenceRef.current;
    setDiffLoading(true);

    (async () => {
      const monaco = await loadMonaco();
      const container = diffContainerRef.current;
      if (!container || sequence !== requestSequenceRef.current) {
        return;
      }
      monacoRef.current = monaco;

      const selectedContent = await contentFor(revision);
      const previous = revisions[selectedIndex + 1];
      const originalText =
        compareTo === "previous" ? (previous ? await contentFor(previous) : "") : selectedContent;
      const modifiedText = compareTo === "previous" ? selectedContent : currentContent;
      if (sequence !== requestSequenceRef.current) {
        return;
      }

      if (!diffEditorRef.current) {
        diffEditorRef.current = monaco.editor.createDiffEditor(container, {
          automaticLayout: true,
          minimap: { enabled: false },
          readOnly: true,
          renderSideBySide: true,
          scrollBeyondLastLine: false,
          wordWrap: "on",
        });
      }
      monaco.editor.setTheme(themeMode === "dark" ? "vs-dark" : "vs");

      const oldModel = diffEditorRef.current.getModel();
      diffEditorRef.current.setModel({
        original: monaco.editor.createModel(originalText, "markdown"),
        modified: monaco.editor.createModel(modifiedText, "markdown"),
      });
      oldModel?.original?.dispose();
      oldModel?.modified?.dispose();
    })()
      .catch((diffError: unknown) => {
        if (sequence === requestSequenceRef.current) {
          setError(diffError instanceof Error ? diffError.message : "Unable to load the revision.");
        }
      })
      .finally(() => {
        if (sequence === requestSequenceRef.current) {
          setDiffLoading(false);
        }
      });
  }, [compareTo, contentFor, currentContent, loading, revisions, selectedIndex, themeMode]);

  // Dispose Monaco resources on unmount.
  useEffect(() => {
    return () => {
      const model = diffEditorRef.current?.getModel();
      diffEditorRef.current?.dispose();
      model?.original?.dispose();
      model?.modified?.dispose();
    };
  }, []);

  async function handleRestore() {
    const revision = revisions[selectedIndex];
    if (!revision) {
      return;
    }
    setRestoring(true);
    try {
      const content = await contentFor(revision);
      onRestore(content);
      onClose();
    } catch (restoreError: unknown) {
      setError(restoreError instanceof Error ? restoreError.message : "Unable to load the revision.");
    } finally {
      setRestoring(false);
    }
  }

  const selected = revisions[selectedIndex];

  return (
    <div className="wiki-export-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="wiki-history-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="wiki-export-header">
          <h2>History — {pageTitle}</h2>
          <button aria-label="Close" className="wiki-export-close" onClick={onClose} type="button">
            &times;
          </button>
        </div>

        {loading ? <p className="wiki-history-status">Loading history…</p> : null}
        {error ? <p className="wiki-export-error" role="alert">{error}</p> : null}

        {!loading && revisions.length > 0 ? (
          <div className="wiki-history-body">
            <div className="wiki-history-list" role="listbox" aria-label="Revisions">
              {revisions.map((revision, index) => (
                <button
                  aria-selected={index === selectedIndex}
                  className={index === selectedIndex ? "wiki-history-item selected" : "wiki-history-item"}
                  key={revision.commitId}
                  onClick={() => setSelectedIndex(index)}
                  role="option"
                  type="button"
                >
                  <span className="wiki-history-item-top">
                    <strong>{revision.authorName ?? "Unknown"}</strong>
                    <span className="wiki-history-item-date">{formatRevisionDate(revision.date)}</span>
                  </span>
                  <span className="wiki-history-item-comment" title={revision.comment}>
                    {revision.comment || revision.commitId.slice(0, 8)}
                  </span>
                </button>
              ))}
            </div>
            <div className="wiki-history-diff-pane">
              <div className="wiki-history-diff-bar">
                <label>
                  <input
                    checked={compareTo === "previous"}
                    onChange={() => setCompareTo("previous")}
                    type="radio"
                  />
                  Changes in this revision
                </label>
                <label>
                  <input
                    checked={compareTo === "current"}
                    onChange={() => setCompareTo("current")}
                    type="radio"
                  />
                  Compare to current
                </label>
                {diffLoading ? <span className="wiki-history-status" role="status">Loading…</span> : null}
                <button
                  className="wiki-export-primary wiki-history-restore"
                  disabled={restoring || !selected}
                  onClick={() => void handleRestore()}
                  title="Open the editor with this revision's content so you can review and save it"
                  type="button"
                >
                  {restoring ? "Restoring…" : "Restore this version"}
                </button>
              </div>
              <div className="wiki-history-diff" ref={diffContainerRef} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatRevisionDate(date: string | undefined): string {
  if (!date) {
    return "";
  }
  try {
    return new Date(date).toLocaleString();
  } catch {
    return date;
  }
}
