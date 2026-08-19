import { useMemo, useState } from "react";

import type { LinkedWikiPage } from "../../host/WikiHost";
import type { WikiPageLink } from "./WikiPageEditor";
import { splitOnMatch } from "./matchSegments";

interface WikiLinkedPagesRailProps {
  readonly pages: readonly LinkedWikiPage[];
  readonly loading: boolean;
  readonly error?: string;
  /** Every page in the wiki, for the picker. */
  readonly allPages: readonly WikiPageLink[];
  readonly activePath?: string;
  readonly onSelect: (path: string) => void;
  /** Links a page. Rejects with a message worth showing if it cannot. */
  readonly onAdd: (path: string) => Promise<void>;
  /** Opens the work item's own Links tab, where links are removed. */
  readonly onManage?: () => void;
}

/**
 * The rail on the work item form: the wiki pages linked to this work item,
 * instead of the whole page tree.
 *
 * Removal is deliberately absent. The work item's own Links tab already owns
 * that, and it removes every kind of link consistently — a second delete here
 * would be a second place for it to go wrong.
 */
export function WikiLinkedPagesRail({
  pages,
  loading,
  error,
  allPages,
  activePath,
  onSelect,
  onAdd,
  onManage,
}: WikiLinkedPagesRailProps) {
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("");
  const [addError, setAddError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const linkedPaths = useMemo(() => new Set(pages.map((page) => page.path)), [pages]);

  // Pages already linked are left out rather than shown and rejected on click.
  const candidates = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return allPages
      .filter((page) => !linkedPaths.has(page.path))
      .filter((page) => (query ? page.path.toLowerCase().includes(query) : true))
      .slice(0, 50);
  }, [allPages, filter, linkedPaths]);

  async function link(path: string) {
    setBusy(true);
    setAddError(undefined);
    try {
      await onAdd(path);
      setAdding(false);
      setFilter("");
    } catch (failure: unknown) {
      setAddError(failure instanceof Error ? failure.message : "That page could not be linked.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside aria-label="Linked wiki pages" className="powerwiki-nav powerwiki-linked-rail">
      <div className="powerwiki-linked-header">
        <span className="powerwiki-linked-title">Linked pages</span>
        <button
          className="powerwiki-linked-add"
          disabled={busy}
          onClick={() => {
            setAdding((open) => !open);
            setAddError(undefined);
          }}
          title="Link a wiki page to this work item"
          type="button"
        >
          {adding ? "Cancel" : "Add"}
        </button>
      </div>

      {adding ? (
        <div className="powerwiki-linked-picker">
          <input
            aria-label="Find a page to link"
            autoFocus
            disabled={busy}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Find a page…"
            type="search"
            value={filter}
          />
          <div className="powerwiki-linked-candidates">
            {candidates.length === 0 ? (
              <p className="powerwiki-linked-empty">No matching pages.</p>
            ) : (
              candidates.map((page) => (
                <button
                  className="powerwiki-linked-candidate"
                  disabled={busy}
                  key={page.path}
                  onClick={() => void link(page.path)}
                  title={page.path}
                  type="button"
                >
                  {splitOnMatch(page.title, filter).map((segment, index) =>
                    segment.isMatch ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>
                  )}
                </button>
              ))
            )}
          </div>
          {addError ? (
            <p className="powerwiki-linked-error" role="alert">
              {addError}
            </p>
          ) : null}
          <p className="powerwiki-linked-hint">Save the work item to keep the link.</p>
        </div>
      ) : null}

      {error ? (
        <p className="powerwiki-linked-error" role="alert">
          {error}
        </p>
      ) : loading ? (
        <p className="powerwiki-linked-empty">Loading linked pages…</p>
      ) : pages.length === 0 ? (
        <p className="powerwiki-linked-empty">
          No wiki pages are linked to this work item yet. Choose <strong>Add</strong> to link one.
        </p>
      ) : (
        <ul className="powerwiki-linked-list">
          {pages.map((page) => (
            <li key={page.path}>
              <button
                aria-current={page.path === activePath ? "true" : undefined}
                className={page.path === activePath ? "powerwiki-linked-item active" : "powerwiki-linked-item"}
                onClick={() => onSelect(page.path)}
                title={page.path}
                type="button"
              >
                <span className="powerwiki-linked-item-title">{titleOf(page.path)}</span>
                {page.comment ? <span className="powerwiki-linked-item-note">{page.comment}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {onManage && pages.length > 0 ? (
        <button className="powerwiki-linked-manage" onClick={onManage} type="button">
          Manage links…
        </button>
      ) : null}
    </aside>
  );
}

function titleOf(path: string): string {
  const segment = path.split("/").filter(Boolean).pop();
  return segment ?? path;
}
