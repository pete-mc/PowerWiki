import { useMemo, useState } from "react";

import type { LinkedWikiPage } from "../../host/WikiHost";
import type { WikiPageLink } from "./WikiPageEditor";
import { TrashIcon } from "./WikiPageIcons";
import { splitOnMatch } from "./matchSegments";

interface WikiLinkedPagesRailProps {
  readonly pages: readonly LinkedWikiPage[];
  readonly loading: boolean;
  readonly error?: string;
  /** Every page in the wiki, for the picker. */
  readonly allPages: readonly WikiPageLink[];
  /** True while `allPages` is still being fetched, so an empty list is not "none". */
  readonly allPagesLoading?: boolean;
  /** Why the wiki's page list could not be fetched, if it could not. */
  readonly allPagesError?: string;
  readonly activePath?: string;
  readonly onSelect: (path: string) => void;
  /** Links a page. Rejects with a message worth showing if it cannot. */
  readonly onAdd: (path: string) => Promise<void>;
  /**
   * Unlinks a page, after confirming with the user. Resolves without doing
   * anything if they decline; rejects with a message worth showing if it fails.
   */
  readonly onUnlink: (page: LinkedWikiPage) => Promise<void>;
  /**
   * Asked for the wiki's page list when the picker opens. The rail cannot fetch
   * it itself, and waiting for a background prefetch meant Add opened offering
   * only the root pages.
   */
  readonly onPickerOpened?: () => void;
}

/**
 * The rail on the work item form: the wiki pages linked to this work item,
 * instead of the whole page tree.
 *
 * Each linked page carries an unlink button. That reverses an earlier decision
 * to leave removal to the work item's own Links tab, on the grounds that a
 * second delete would be a second place for it to go wrong. In practice it was
 * a second place to *find* it: the only route out of this rail was a button that
 * reopened the work item at its Details tab, losing the reader's place — and in
 * a modal work item dialog, closing the dialog outright. Unlinking here uses the
 * same form service `add` does, so both halves of the same operation now behave
 * identically: the form is left dirty and the user saves.
 */
export function WikiLinkedPagesRail({
  pages,
  loading,
  error,
  allPages,
  allPagesLoading,
  allPagesError,
  activePath,
  onSelect,
  onAdd,
  onUnlink,
  onPickerOpened,
}: WikiLinkedPagesRailProps) {
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("");
  const [addError, setAddError] = useState<string>();
  const [busy, setBusy] = useState(false);
  // The page whose unlink is in flight (including its confirmation), so only
  // that row goes quiet rather than the whole rail.
  const [unlinking, setUnlinking] = useState<string>();
  const [unlinkError, setUnlinkError] = useState<string>();

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

  async function unlink(page: LinkedWikiPage) {
    setUnlinking(page.path);
    setUnlinkError(undefined);
    try {
      await onUnlink(page);
    } catch (failure: unknown) {
      setUnlinkError(failure instanceof Error ? failure.message : "That page could not be unlinked.");
    } finally {
      setUnlinking(undefined);
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
            setAdding((open) => {
              if (!open) {
                onPickerOpened?.();
              }
              return !open;
            });
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
            {candidates.length > 0 ? (
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
            ) : allPagesError ? (
              // "No matching pages" would be a lie when the list never arrived.
              <p className="powerwiki-linked-error" role="alert">
                The wiki&rsquo;s pages could not be loaded. {allPagesError}
              </p>
            ) : allPagesLoading ? (
              <p className="powerwiki-linked-empty">Loading the wiki&rsquo;s pages…</p>
            ) : (
              <p className="powerwiki-linked-empty">No matching pages.</p>
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
            <li className="powerwiki-linked-row" key={page.path}>
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
              <button
                aria-label={`Unlink ${titleOf(page.path)} from this work item`}
                className="powerwiki-linked-unlink"
                disabled={unlinking !== undefined}
                onClick={() => void unlink(page)}
                title={`Unlink ${titleOf(page.path)} from this work item`}
                type="button"
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      {unlinkError ? (
        <p className="powerwiki-linked-error" role="alert">
          {unlinkError}
        </p>
      ) : null}
    </aside>
  );
}

function titleOf(path: string): string {
  const segment = path.split("/").filter(Boolean).pop();
  return segment ?? path;
}
