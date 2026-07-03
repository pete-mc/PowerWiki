import type { WikiPageChange } from "../../wiki/WikiComment";
import { CommentIcon } from "./WikiPageIcons";

export interface WikiPageBylineProps {
  readonly change?: WikiPageChange;
  readonly changeLoading?: boolean;
  readonly commentCount?: number;
  readonly commentsOpen: boolean;
  readonly onToggleComments: () => void;
}

/**
 * Header metadata for the current page: who last changed the page, when it was
 * last edited, and a comments toggle that shows the current comment count.
 */
export function WikiPageByline({
  change,
  changeLoading,
  commentCount,
  commentsOpen,
  onToggleComments,
}: WikiPageBylineProps) {
  const author = change?.authorName ?? (changeLoading ? "Loading" : "Not available");
  const when = change?.date ? formatDate(change.date) : (changeLoading ? "Loading" : "Not available");

  return (
    <div className="wiki-byline">
      <span className="wiki-byline-meta">
        <span className="wiki-byline-item">
          <span className="wiki-byline-label">Author</span>
          <span>{author}</span>
        </span>
        <span className="wiki-byline-item">
          <span className="wiki-byline-label">Last edited</span>
          <span>{when}</span>
        </span>
      </span>
      <button
        aria-label={commentsOpen ? "Hide comments" : "Show comments"}
        aria-pressed={commentsOpen}
        className={commentsOpen ? "wiki-byline-comments active" : "wiki-byline-comments"}
        onClick={onToggleComments}
        type="button"
      >
        <CommentIcon />
        <span>Comments</span>
        <span className="wiki-byline-comment-count">{commentCount ?? 0}</span>
      </button>
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes < 1) {
    return "just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
