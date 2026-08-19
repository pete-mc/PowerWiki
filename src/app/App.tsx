import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WikiHost } from "../host/WikiHost";
import type { HeaderMenuAction } from "./HeaderMenuAction";
import { WikiPageByline, type WikiPageBylineProps } from "./wiki/WikiPageByline";
import { WikiBrowser } from "./wiki/WikiBrowser";
import packageMetadata from "../../package.json";

interface AppProps {
  readonly error?: unknown;
  /**
   * Everything host-specific (see `src/host/WikiHost.ts`). Absent while the host
   * is still initialising or has failed, which is what `status` reports.
   */
  readonly host?: WikiHost;
  /**
   * Where the PowerWiki logo is served from. The hub resolves it relative to the
   * bundle; a VS Code webview needs an explicit `vscode-resource` URI, because
   * relative paths there resolve against the webview's own opaque origin.
   */
  readonly logoUrl?: string;
  readonly status: "failed" | "loading" | "ready";
}

export function App({ error, host, logoUrl = "../media/logo_new.png", status }: AppProps) {
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const [headerMenuActions, setHeaderMenuActions] = useState<readonly HeaderMenuAction[]>([]);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const [pageByline, setPageByline] = useState<WikiPageBylineProps>();
  const [pageTitle, setPageTitle] = useState<string>();
  // Full-text search lives in the header, next to the brand, and renders its
  // results into the content area — so the query is owned here and handed down,
  // while the tree's name filter stays private to the browser.
  const [searchQuery, setSearchQuery] = useState("");
  const headerTitle = useMemo(() => {
    if (status === "loading") {
      return "Loading PowerWiki";
    }

    if (status === "failed") {
      return "Unable to load PowerWiki";
    }

    return pageTitle ?? "PowerWiki";
  }, [pageTitle, status]);
  const handlePageTitleChange = useCallback((title: string | undefined) => {
    setPageTitle(title);
  }, []);

  useEffect(() => {
    if (status !== "ready") {
      setPageTitle(undefined);
      setPageByline(undefined);
      setHeaderMenuActions([]);
    }
  }, [status]);

  useEffect(() => {
    if (!isHeaderMenuOpen) {
      return;
    }

    function handleDocumentPointerDown(event: PointerEvent) {
      if (!headerMenuRef.current?.contains(event.target as Node)) {
        setIsHeaderMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
    };
  }, [isHeaderMenuOpen]);

  return (
    <main className="powerwiki-shell">
      <header className="powerwiki-header">
        <div className="powerwiki-header-title">
          <h1>{headerTitle}</h1>
          {pageByline ? <WikiPageByline {...pageByline} /> : null}
        </div>
        <div className="powerwiki-header-right">
          <div className="powerwiki-header-right-stack">
            <div className="powerwiki-brand" aria-label={`PowerWiki version ${packageMetadata.version}`}>
              <img alt="" src={logoUrl} />
              <div>
                <strong>PowerWiki</strong>
                <span>Version {packageMetadata.version}</span>
              </div>
            </div>
            {status === "ready" ? (
              <div className="powerwiki-header-search">
                <input
                  aria-label="Search all pages"
                  className="powerwiki-header-search-input"
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setSearchQuery("");
                    }
                  }}
                  placeholder="Search all pages…"
                  type="search"
                  value={searchQuery}
                />
                {searchQuery ? (
                  <button
                    aria-label="Clear search"
                    className="powerwiki-header-search-clear"
                    onClick={() => setSearchQuery("")}
                    type="button"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {headerMenuActions.length > 0 ? (
            <div className="powerwiki-header-menu" ref={headerMenuRef}>
              <button
                aria-expanded={isHeaderMenuOpen}
                aria-haspopup="menu"
                aria-label="Page actions"
                className="powerwiki-header-menu-button"
                onClick={() => setIsHeaderMenuOpen((open) => !open)}
                type="button"
              >
                ⋮
              </button>
              {isHeaderMenuOpen ? (
                <div className="powerwiki-header-menu-popover" role="menu">
                  {headerMenuActions.map((action) => (
                    <button
                      disabled={action.disabled}
                      key={action.id}
                      onClick={() => {
                        setIsHeaderMenuOpen(false);
                        action.onClick();
                      }}
                      role="menuitem"
                      type="button"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {status === "failed" ? (
        <section className="powerwiki-panel" role="alert">
          <h2>Unable to load PowerWiki</h2>
          <p>{formatError(error)}</p>
        </section>
      ) : (
        host ? (
          <WikiBrowser
            host={host}
            onHeaderMenuActionsChange={setHeaderMenuActions}
            onPageBylineChange={setPageByline}
            onPageTitleChange={handlePageTitleChange}
            onSearchQueryChange={setSearchQuery}
            searchQuery={searchQuery}
          />
        ) : null
      )}
    </main>
  );
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "An unknown error occurred while initializing the extension host.";
}
