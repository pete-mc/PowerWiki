import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import * as SDK from "azure-devops-extension-sdk";
import { MarkdownPreview } from "../../rendering/MarkdownPreview";
import { AzureDevOpsWikiRepositoryClient } from "../../wiki/AzureDevOpsWikiRepositoryClient";
import type { WikiPage, WikiPageSummary, WikiSummary } from "../../wiki/WikiPage";
import { buildWikiPageTree } from "../../wiki/WikiPageTree";
import { StatusMessage } from "./StatusMessage";
import { WikiPageTree } from "./WikiPageTree";
import { WikiSelector } from "./WikiSelector";

interface WikiBrowserProps {
  readonly projectName?: string;
}

type LoadState = "failed" | "loading" | "ready";

interface IHostNavigationService {
  getHash(): Promise<string>;
  setHash(hash: string): Promise<void>;
  onHashChanged(callback: (hash: string) => void): void;
}

const HOST_NAVIGATION_SERVICE_ID = "ms.vss-features.host-navigation-service";

async function getNavigationService(): Promise<IHostNavigationService | undefined> {
  try {
    return await SDK.getService<IHostNavigationService>(HOST_NAVIGATION_SERVICE_ID);
  } catch {
    return undefined;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseNavigationHash(hash: string): { wikiId: string; pagePath: string } | undefined {
  const colonIndex = hash.indexOf(":");
  if (colonIndex <= 0) {
    return undefined;
  }
  const wikiId = hash.slice(0, colonIndex);
  const rawPath = hash.slice(colonIndex + 1);
  return { wikiId, pagePath: safeDecode(rawPath) };
}

function buildNavigationHash(wikiId: string, pagePath: string): string {
  return `${wikiId}:${pagePath}`;
}

/**
 * Returns the candidate page paths to try, in priority order.
 *
 * Azure DevOps wiki links written in markdown use hyphens where the actual
 * page title has spaces (the backing file is e.g. "Current-State.md" for the
 * page "/Ecosystem/Current State"). We therefore try the path as-authored
 * first, then a hyphen-to-space variant so both link styles resolve.
 */
function pagePathCandidates(rawPath: string): string[] {
  const decoded = safeDecode(rawPath);
  const candidates = [decoded];
  const spaced = decoded.replace(/-/g, " ");
  if (spaced !== decoded) {
    candidates.push(spaced);
  }
  return candidates;
}

export function WikiBrowser({ projectName }: WikiBrowserProps) {
  const [activePage, setActivePage] = useState<WikiPage>();
  const [activeWikiId, setActiveWikiId] = useState<string>();
  const [error, setError] = useState<string>();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadedPaths, setLoadedPaths] = useState<ReadonlySet<string>>(new Set());
  const [navigationReady, setNavigationReady] = useState(false);
  const [pageList, setPageList] = useState<WikiPageSummary[]>([]);
  const [wikis, setWikis] = useState<WikiSummary[]>([]);

  const savedNavigation = useRef<{ wikiId: string; pagePath: string } | null>(null);
  const navigationServiceRef = useRef<IHostNavigationService | undefined>(undefined);
  // The last page path we navigated to. Used to ignore onHashChanged events that
  // are echoes of our own setHash() calls, preventing navigation loops.
  const lastNavigatedPathRef = useRef<string | undefined>(undefined);

  const wikiClient = useMemo(() => {
    return projectName ? new AzureDevOpsWikiRepositoryClient(projectName) : undefined;
  }, [projectName]);
  const activeWiki = useMemo(
    () => wikis.find((wiki) => wiki.id === activeWikiId),
    [activeWikiId, wikis]
  );
  const pageTree = useMemo(
    () => buildWikiPageTree(pageList, loadedPaths),
    [loadedPaths, pageList]
  );

  // Loads a page by path, trying hyphen/space variants, and (optionally) syncs
  // the URL hash. This is the single entry point for all navigation:
  // tree clicks, in-page links, deep links, and browser back/forward.
  const loadPageByPath = useCallback(
    async (rawPath: string, updateHash: boolean): Promise<boolean> => {
      if (!wikiClient || !activeWikiId) {
        return false;
      }

      setLoadState("loading");
      setError(undefined);

      for (const candidate of pagePathCandidates(rawPath)) {
        try {
          const page = await wikiClient.getPage(activeWikiId, candidate);
          setActivePage(page);
          setLoadState("ready");
          lastNavigatedPathRef.current = page.path;
          if (updateHash && navigationServiceRef.current) {
            void navigationServiceRef.current.setHash(
              buildNavigationHash(activeWikiId, page.path)
            );
          }
          return true;
        } catch {
          // Try the next candidate.
        }
      }

      setLoadState("failed");
      setError(`Page not found: ${safeDecode(rawPath)}`);
      return false;
    },
    [wikiClient, activeWikiId]
  );
  // Handles URL hash changes that originate outside our own navigation:
  // browser back/forward, or the user editing the URL. Kept in a ref so the
  // once-registered onHashChanged listener always sees current state.
  const hashChangeHandlerRef = useRef<(hash: string) => void>(() => {});
  hashChangeHandlerRef.current = (hash: string) => {
    const parsed = parseNavigationHash(hash);
    if (!parsed) {
      return;
    }

    // ADO's host emits hash-change events during its own routing whose values
    // do not match our "wikiId:path" format. Only act when the parsed wikiId is
    // a wiki we actually know about — otherwise we would switch to a bogus id
    // and every subsequent API call would fail.
    if (!wikis.some((wiki) => wiki.id === parsed.wikiId)) {
      return;
    }

    // A different (known) wiki was requested via the URL — switch to it and let
    // the page-load effect restore the requested page.
    if (parsed.wikiId !== activeWikiId) {
      savedNavigation.current = parsed;
      setActiveWikiId(parsed.wikiId);
      return;
    }

    // Ignore echoes of our own setHash() call.
    if (parsed.pagePath === lastNavigatedPathRef.current) {
      return;
    }

    void loadPageByPath(parsed.pagePath, false);
  };

  useEffect(() => {
    async function initNavigation() {
      const navService = await getNavigationService();
      navigationServiceRef.current = navService;
      if (navService) {
        const hash = await navService.getHash();
        const parsed = parseNavigationHash(hash);
        if (parsed) {
          savedNavigation.current = parsed;
        }
        navService.onHashChanged((changedHash) => {
          hashChangeHandlerRef.current(changedHash);
        });
      }
      setNavigationReady(true);
    }
    void initNavigation();
  }, []);

  useEffect(() => {
    if (!navigationReady) {
      return;
    }

    if (!wikiClient) {
      setLoadState("failed");
      setError("PowerWiki needs an Azure DevOps project context.");
      return;
    }

    let cancelled = false;
    const client = wikiClient;

    async function loadWikis() {
      setLoadState("loading");
      setError(undefined);

      try {
        const availableWikis = await client.getWikis();

        if (cancelled) {
          return;
        }

        setWikis(availableWikis);

        if (availableWikis.length === 0) {
          setLoadState("ready");
          return;
        }

        const savedWikiId = savedNavigation.current?.wikiId;
        const targetWikiId =
          savedWikiId && availableWikis.some((w) => w.id === savedWikiId)
            ? savedWikiId
            : availableWikis[0]?.id;
        setActiveWikiId(targetWikiId);
      } catch (loadError: unknown) {
        if (!cancelled) {
          setLoadState("failed");
          setError(formatError(loadError));
        }
      }
    }

    void loadWikis();
    return () => { cancelled = true; };
  }, [navigationReady, wikiClient]);

  useEffect(() => {
    if (!wikiClient || !activeWikiId || !activeWiki) {
      return;
    }

    let cancelled = false;
    const client = wikiClient;
    const wikiId = activeWikiId;

    async function loadPages() {
      setLoadState("loading");
      setError(undefined);
      setActivePage(undefined);
      setPageList([]);
      setLoadedPaths(new Set());

      try {
        const rootPages = await client.getChildPages(wikiId, "/");

        if (cancelled) return;

        const saved = savedNavigation.current;
        const savedPath = saved?.wikiId === wikiId ? saved.pagePath : undefined;
        savedNavigation.current = null;

        setPageList(rootPages);
        setLoadedPaths(new Set(["/"]));

        // Resolve the initial/deep-linked page, trying hyphen/space variants,
        // then falling back to the wiki home page if the saved path is gone.
        // The tree auto-expands to the active page via path-string ancestor
        // detection in WikiPageTree, so no ancestor pre-loading is needed here.
        const targetPath = savedPath ?? chooseInitialPage(rootPages);
        let initialPage: WikiPage | undefined;

        if (targetPath) {
          for (const candidate of pagePathCandidates(targetPath)) {
            try {
              initialPage = await client.getPage(wikiId, candidate);
              break;
            } catch {
              // Try the next candidate.
            }
          }

          if (!initialPage && savedPath) {
            const fallback = chooseInitialPage(rootPages);
            if (fallback) {
              initialPage = await client.getPage(wikiId, fallback).catch(() => undefined);
            }
          }
        }

        if (cancelled) return;

        setActivePage(initialPage);
        setLoadState("ready");

        if (initialPage) {
          lastNavigatedPathRef.current = initialPage.path;
          if (navigationServiceRef.current) {
            void navigationServiceRef.current.setHash(
              buildNavigationHash(wikiId, initialPage.path)
            );
          }
        }
      } catch (loadError: unknown) {
        if (!cancelled) {
          setLoadState("failed");
          setError(formatError(loadError));
        }
      }
    }

    void loadPages();
    return () => { cancelled = true; };
  }, [activeWikiId, wikiClient]);

  async function handleNodeExpand(path: string): Promise<void> {
    if (!wikiClient || !activeWikiId || loadedPaths.has(path)) {
      return;
    }

    try {
      const children = await wikiClient.getChildPages(activeWikiId, path);
      setPageList((prev) => {
        const known = new Set(prev.map((p) => p.path));
        return [...prev, ...children.filter((p) => !known.has(p.path))];
      });
    } catch {
      // Leave the child list unchanged, but still mark the path as loaded below
      // so the tree clears its "Loading…" indicator instead of spinning forever.
    } finally {
      setLoadedPaths((prev) => new Set([...prev, path]));
    }
  }

  async function handlePageSelected(path: string) {
    await loadPageByPath(path, true);
  }

  if (loadState === "failed") {
    return (
      <StatusMessage
        message={error ?? "PowerWiki could not load wiki content."}
        title="Unable to load wiki"
      />
    );
  }

  return (
    <section className="powerwiki-layout">
      <aside className="powerwiki-nav" aria-label="Wiki pages">
        <WikiSelector
          activeWikiId={activeWikiId}
          disabled={loadState === "loading"}
          onWikiSelected={(wikiId) => {
            savedNavigation.current = null;
            setActiveWikiId(wikiId);
          }}
          wikis={wikis}
        />
        <WikiPageTree
          activePath={activePage?.path}
          nodes={pageTree}
          onNodeExpand={handleNodeExpand}
          onPageSelected={handlePageSelected}
        />
      </aside>

      <article className="powerwiki-content">
        {activePage ? (
          <MarkdownPreview
            markdown={activePage.content}
            currentPath={activePage.path}
            onNavigate={(path) => void loadPageByPath(path, true)}
          />
        ) : (
          <StatusMessage
            message={loadState === "loading" ? "Loading wiki content." : "Select a page to view it."}
            title={loadState === "loading" ? "Loading" : "No page selected"}
          />
        )}
      </article>
    </section>
  );
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "An unknown error occurred while loading wiki content.";
}

function chooseInitialPage(pages: readonly WikiPageSummary[]): string | undefined {
  return (
    pages.find((page) => page.path === "/Home")?.path ??
    pages.find((page) => page.order === 0)?.path ??
    pages[0]?.path
  );
}
