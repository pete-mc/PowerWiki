import { useEffect, useMemo, useRef } from "react";

import { createMarkdownRenderer } from "./createMarkdownRenderer";
import { renderMermaidDiagrams } from "./renderMermaidDiagrams";
import { sanitizeRenderedHtml } from "./sanitizeRenderedHtml";

interface MarkdownPreviewProps {
  readonly markdown: string;
  /** Wiki path of the page being rendered; used to resolve relative links. */
  readonly currentPath?: string;
  /** Called when an internal wiki link is clicked, with the resolved wiki path. */
  readonly onNavigate?: (path: string) => void;
}

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

export function MarkdownPreview({ markdown, currentPath, onNavigate }: MarkdownPreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const html = useMemo(
    () => sanitizeRenderedHtml(markdownRenderer.render(markdown)),
    [markdown]
  );

  useEffect(() => {
    if (!previewRef.current) {
      return;
    }

    void renderMermaidDiagrams(previewRef.current);
  }, [html]);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    // Ignore modified clicks so users can still open links in a new tab.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
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
    />
  );
}

