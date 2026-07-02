import { useEffect, useMemo, useRef } from "react";

import { TOSP_PLACEHOLDER_ATTR, TOSP_PLACEHOLDER_VALUE } from "./adoPlaceholdersPlugin";
import { createMarkdownRenderer } from "./createMarkdownRenderer";
import { renderMermaidDiagrams } from "./renderMermaidDiagrams";
import { sanitizeRenderedHtml } from "./sanitizeRenderedHtml";

/** A direct child of the current page, used to fill the [[_TOSP_]] placeholder. */
export interface WikiSubPage {
  readonly path: string;
  readonly title: string;
}

interface MarkdownPreviewProps {
  readonly markdown: string;
  /** Wiki path of the page being rendered; used to resolve relative links. */
  readonly currentPath?: string;
  /** Direct child pages, rendered where a [[_TOSP_]] placeholder appears. */
  readonly subPages?: readonly WikiSubPage[];
  /** Resolves rendered image sources to browser-loadable URLs. */
  readonly onResolveImageSrc?: (src: string, currentPath: string) => Promise<string | undefined>;
  /** Called when an internal wiki link is clicked, with the resolved wiki path. */
  readonly onNavigate?: (path: string) => void;
}

const TOSP_PLACEHOLDER_SELECTOR = `[${TOSP_PLACEHOLDER_ATTR}="${TOSP_PLACEHOLDER_VALUE}"]`;

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

export function MarkdownPreview({ markdown, currentPath, subPages, onNavigate, onResolveImageSrc }: MarkdownPreviewProps) {
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

  useEffect(() => {
    const container = previewRef.current;
    if (!container) {
      return;
    }

    const placeholders = Array.from(container.querySelectorAll(TOSP_PLACEHOLDER_SELECTOR));
    for (const placeholder of placeholders) {
      placeholder.replaceChildren();

      if (!subPages || subPages.length === 0) {
        const empty = document.createElement("p");
        empty.className = "powerwiki-subpages-empty";
        empty.textContent = "No subpages.";
        placeholder.appendChild(empty);
        continue;
      }

      const list = document.createElement("ul");
      for (const subPage of subPages) {
        const item = document.createElement("li");
        const anchor = document.createElement("a");
        // Absolute wiki path; handleClick resolves it to an in-app navigation.
        anchor.setAttribute("href", encodeURI(subPage.path));
        anchor.textContent = subPage.title;
        item.appendChild(anchor);
        list.appendChild(item);
      }
      placeholder.appendChild(list);
    }
  }, [html, subPages]);

  useEffect(() => {
    if (!previewRef.current || !currentPath || !onResolveImageSrc) {
      return;
    }

    let cancelled = false;
    const resolvedObjectUrls: string[] = [];
    const images = Array.from(previewRef.current.querySelectorAll("img"));

    for (const image of images) {
      const src = image.getAttribute("src");
      if (!src) {
        continue;
      }

      void onResolveImageSrc(src, currentPath)
        .then((resolvedSrc) => {
          if (cancelled || !resolvedSrc) {
            return;
          }

          if (resolvedSrc.startsWith("blob:")) {
            resolvedObjectUrls.push(resolvedSrc);
          }
          image.setAttribute("src", resolvedSrc);
        })
        .catch(() => {
          // Leave the original src in place so the browser shows the normal broken image state.
        });
    }

    return () => {
      cancelled = true;
      for (const objectUrl of resolvedObjectUrls) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [currentPath, html, onResolveImageSrc]);

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
