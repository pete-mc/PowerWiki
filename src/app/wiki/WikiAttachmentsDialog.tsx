import { useEffect, useMemo, useState } from "react";

import { copyToClipboard } from "../../rendering/clipboard";
import { attachmentMarkdown, isImagePath } from "../../wiki/attachmentUpload";
import type { WikiAttachment } from "../../wiki/WikiPage";

interface WikiAttachmentsDialogProps {
  readonly loadAttachments: () => Promise<readonly WikiAttachment[]>;
  /** Resolves an attachment path to its authenticated Git Items URL. */
  readonly resolveImageSrc?: (src: string, currentPath: string) => string | undefined;
  /** Fetches a resolved URL as a displayable object URL (authenticated). */
  readonly onLoadImage?: (url: string) => Promise<string>;
  readonly onClose: () => void;
}

/** Browse and reference the wiki's stored attachments. */
export function WikiAttachmentsDialog({
  loadAttachments,
  resolveImageSrc,
  onLoadImage,
  onClose,
}: WikiAttachmentsDialogProps) {
  const [attachments, setAttachments] = useState<readonly WikiAttachment[] | undefined>(undefined);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [copiedPath, setCopiedPath] = useState<string>();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    loadAttachments()
      .then((loaded) => {
        if (!cancelled) {
          setAttachments(loaded);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to list attachments.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttachments]);

  const filtered = useMemo(() => {
    const all = attachments ?? [];
    const needle = query.trim().toLowerCase();
    return needle ? all.filter((attachment) => attachment.name.toLowerCase().includes(needle)) : all;
  }, [attachments, query]);

  function handleCopy(attachment: WikiAttachment) {
    const markdown = attachmentMarkdown({
      name: attachment.name,
      path: attachment.path,
      isImage: isImagePath(attachment.path),
    });
    void copyToClipboard(markdown).then((ok) => {
      setCopiedPath(ok ? attachment.path : undefined);
      window.setTimeout(() => setCopiedPath(undefined), 1500);
    });
  }

  return (
    <div className="wiki-export-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="wiki-attachments-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="wiki-export-header">
          <h2>Attachments {attachments ? `(${attachments.length})` : ""}</h2>
          <button aria-label="Close" className="wiki-export-close" onClick={onClose} type="button">
            &times;
          </button>
        </div>

        <div className="wiki-attachments-bar">
          <input
            aria-label="Filter attachments"
            className="wiki-format-linkpicker-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter attachments…"
            type="search"
            value={query}
          />
        </div>

        {error ? <p className="wiki-export-error" role="alert">{error}</p> : null}

        <div className="wiki-attachments-grid">
          {!attachments ? (
            <p className="wiki-empty-hint">Loading attachments…</p>
          ) : filtered.length === 0 ? (
            <p className="wiki-empty-hint">No attachments found.</p>
          ) : (
            filtered.map((attachment) => {
              const isImage = isImagePath(attachment.path);
              const thumb = isImage ? resolveImageSrc?.(attachment.path, "/") : undefined;
              return (
                <div className="wiki-attachment-card" key={attachment.path}>
                  <div className="wiki-attachment-thumb">
                    {thumb ? (
                      <AttachmentThumb url={thumb} onLoadImage={onLoadImage} fallback={extensionOf(attachment.name)} />
                    ) : (
                      <span className="wiki-attachment-ext">{extensionOf(attachment.name)}</span>
                    )}
                  </div>
                  <div className="wiki-attachment-name" title={attachment.path}>{attachment.name}</div>
                  <div className="wiki-attachment-actions">
                    <button onClick={() => handleCopy(attachment)} title="Copy the Markdown reference" type="button">
                      {copiedPath === attachment.path ? "Copied" : "Copy Markdown"}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Renders an attachment thumbnail. The Git Items URL is authenticated, so a bare
 * <img src> can't load it from the sandboxed iframe — the bytes are fetched with
 * credentials into an object URL instead (revoked when the card unmounts). Shows
 * the file-extension badge while loading or if the fetch fails.
 */
function AttachmentThumb({
  url,
  onLoadImage,
  fallback,
}: {
  readonly url: string;
  readonly onLoadImage?: (url: string) => Promise<string>;
  readonly fallback: string;
}) {
  const [objectUrl, setObjectUrl] = useState<string>();

  useEffect(() => {
    if (!onLoadImage) {
      return;
    }
    let revoke: string | undefined;
    let cancelled = false;
    onLoadImage(url)
      .then((resolved) => {
        if (cancelled) {
          URL.revokeObjectURL(resolved);
          return;
        }
        revoke = resolved;
        setObjectUrl(resolved);
      })
      .catch(() => {
        // Leave the fallback badge in place.
      });
    return () => {
      cancelled = true;
      if (revoke) {
        URL.revokeObjectURL(revoke);
      }
    };
  }, [onLoadImage, url]);

  // With no authenticated loader, fall back to a direct src (best effort).
  const src = onLoadImage ? objectUrl : url;
  return src ? (
    <img alt="" loading="lazy" src={src} />
  ) : (
    <span className="wiki-attachment-ext">{fallback}</span>
  );
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "FILE";
}
