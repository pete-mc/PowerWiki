import { useState } from "react";

import type { WikiComment } from "../../wiki/WikiComment";
import { CloseIcon } from "./WikiPageIcons";

interface WikiCommentsPanelProps {
  readonly comments: readonly WikiComment[];
  readonly error?: string;
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (text: string) => Promise<void>;
  readonly submitting: boolean;
}

/**
 * Right-hand drawer listing a page's comments with a box to add a new one.
 */
export function WikiCommentsPanel({
  comments,
  error,
  loading,
  onClose,
  onSubmit,
  submitting,
}: WikiCommentsPanelProps) {
  const [draft, setDraft] = useState("");

  const handleSubmit = async () => {
    const text = draft.trim();
    if (!text || submitting) {
      return;
    }

    await onSubmit(text);
    setDraft("");
  };

  return (
    <aside className="powerwiki-sidecar powerwiki-comments" aria-label="Page comments">
      <div className="powerwiki-sidecar-header">
        <h2>Comments</h2>
        <button
          aria-label="Close comments"
          className="powerwiki-sidecar-close"
          onClick={onClose}
          type="button"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="powerwiki-sidecar-list">
        {loading ? (
          <p className="powerwiki-sidecar-status" aria-live="polite">Loading comments…</p>
        ) : error ? (
          <p className="powerwiki-sidecar-status" role="alert">{error}</p>
        ) : comments.length === 0 ? (
          <p className="powerwiki-sidecar-status">No comments yet. Start the conversation.</p>
        ) : (
          comments.map((comment) => (
            <article className="powerwiki-comment" key={comment.id}>
              <div className="powerwiki-comment-head">
                <span className="powerwiki-comment-author">{comment.authorName ?? "Unknown"}</span>
                {comment.createdDate ? (
                  <span className="powerwiki-comment-date">{formatTimestamp(comment.createdDate)}</span>
                ) : null}
              </div>
              <p className="powerwiki-comment-text">{comment.text}</p>
            </article>
          ))
        )}
      </div>

      <div className="powerwiki-comments-compose">
        <textarea
          aria-label="Add a comment"
          disabled={submitting}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder="Add a comment"
          rows={3}
          value={draft}
        />
        <div className="powerwiki-comments-compose-actions">
          <button
            className="powerwiki-comments-submit"
            disabled={submitting || draft.trim().length === 0}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {submitting ? "Adding…" : "Comment"}
          </button>
        </div>
      </div>
    </aside>
  );
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}
