export interface InboundLinkUpdate {
  readonly path: string;
  readonly count: number;
}

interface WikiLinkUpdateDialogProps {
  readonly oldPath: string;
  readonly newPath: string;
  readonly updates: readonly InboundLinkUpdate[];
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onSkip: () => void;
}

/**
 * After a rename/move, previews the pages whose links point at the old path and
 * offers to rewrite them so inbound links don't break.
 */
export function WikiLinkUpdateDialog({ oldPath, newPath, updates, busy, onConfirm, onSkip }: WikiLinkUpdateDialogProps) {
  const totalLinks = updates.reduce((sum, update) => sum + update.count, 0);

  return (
    <div className="wiki-export-overlay" role="dialog" aria-modal="true">
      <div className="wiki-export-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="wiki-export-header">
          <h2>Update links to the moved page?</h2>
        </div>
        <p className="wiki-linkupdate-summary">
          <code>{oldPath}</code> is now <code>{newPath}</code>. {totalLinks} link{totalLinks === 1 ? "" : "s"} on{" "}
          {updates.length} page{updates.length === 1 ? "" : "s"} still point{totalLinks === 1 ? "s" : ""} at the old
          path:
        </p>
        <div className="wiki-linkupdate-list">
          {updates.map((update) => (
            <div className="wiki-linkupdate-item" key={update.path}>
              <span className="wiki-export-item-title" title={update.path}>{update.path}</span>
              <span className="wiki-linkupdate-count">
                {update.count} link{update.count === 1 ? "" : "s"}
              </span>
            </div>
          ))}
        </div>
        <div className="wiki-export-actions">
          <span className="wiki-export-note">Each page is rewritten and saved through the normal wiki API.</span>
          <button disabled={busy} onClick={onSkip} type="button">Skip</button>
          <button className="wiki-export-primary" disabled={busy} onClick={onConfirm} type="button">
            {busy ? "Updating…" : "Update links"}
          </button>
        </div>
      </div>
    </div>
  );
}
