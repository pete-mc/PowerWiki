import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import * as SDK from "azure-devops-extension-sdk";
import { MarkdownPreview, type WikiSubPage } from "../../rendering/MarkdownPreview";
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
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// Matches the Azure DevOps table-of-subpages placeholder in page content so we
// only fetch child pages for pages that actually use it.
const TOSP_PLACEHOLDER = /\[\[_?TOSP_?\]\]/i;

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

function resolveWikiImagePath(src: string, currentPath: string): string | undefined {
  if (!src || src.startsWith("#") || src.startsWith("//") || HAS_SCHEME.test(src)) {
    return undefined;
  }

  try {
    const base = "http://wiki" + encodeURI(currentPath.startsWith("/") ? currentPath : `/${currentPath}`);
    const resolved = new URL(src, base);
    return safeDecode(resolved.pathname);
  } catch {
    return undefined;
  }
}

function buildGitItemUrl(wiki: WikiSummary, projectName: string, wikiPath: string): string | undefined {
  if (!wiki.repositoryId || !wiki.remoteUrl) {
    return undefined;
  }

  const remoteUrl = new URL(wiki.remoteUrl);
  const repositoryPath = joinRepositoryPath(wiki.mappedPath, wikiPath);

  // On dev.azure.com the remoteUrl path is /{org}/{project}/_git/{repo}, so the
  // Items API URL must be /{org}/{project}/_apis/... On legacy visualstudio.com
  // the org is the subdomain and the path starts with /{project}/_git/{repo},
  // so no extra prefix is needed.
  const pathSegments = remoteUrl.pathname.split("/").filter(Boolean);
  const orgPrefix = remoteUrl.hostname === "dev.azure.com" && pathSegments.length > 0
    ? `/${pathSegments[0]}`
    : "";

  const url = new URL(
    `${remoteUrl.origin}${orgPrefix}/${encodeURIComponent(projectName)}/_apis/git/repositories/${encodeURIComponent(wiki.repositoryId)}/Items`
  );
  url.searchParams.set("path", repositoryPath);
  url.searchParams.set("download", "true");
  return url.toString();
}

function joinRepositoryPath(mappedPath: string | undefined, wikiPath: string): string {
  const normalizedMappedPath = !mappedPath || mappedPath === "/" ? "" : trimSlashes(mappedPath);
  const normalizedWikiPath = trimSlashes(wikiPath);
  const combined = [normalizedMappedPath, normalizedWikiPath].filter(Boolean).join("/");
  return `/${combined}`;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

// Azure DevOps serves wiki attachments (images pasted into the editor) from
// a CDN that requires an authenticated Bearer token. Hostnames we recognise:
//   {org}.gallerycdn.vsassets.io  – older CDN pattern seen in the wild
//   {org}.vsassets.io             – alternate CDN pattern
//   dev.azure.com                 – direct API URLs
//   {org}.visualstudio.com        – legacy host
const AZURE_DEVOPS_HOSTNAMES = /(?:^|\.)(vsassets\.io|gallerycdn\.vsassets\.io|dev\.azure\.com|visualstudio\.com)$/i;

function isAzureDevOpsUrl(src: string): boolean {
  try {
    return AZURE_DEVOPS_HOSTNAMES.test(new URL(src).hostname);
  } catch {
    return false;
  }
}

async function fetchAsBlob(url: string): Promise<string> {
  const token = await SDK.getAccessToken();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error(`Image fetch failed: ${response.status}`);
  }
  return URL.createObjectURL(await response.blob());
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
  const [subPages, setSubPages] = useState<readonly WikiSubPage[]>([]);
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

  // Loads the direct children of the active page so a [[_TOSP_]] placeholder can
  // be filled in. Scoped to pages that actually use the placeholder to avoid an
  // extra API call on every page view.
  useEffect(() => {
    if (!wikiClient || !activeWikiId || !activePage || !TOSP_PLACEHOLDER.test(activePage.content)) {
      setSubPages([]);
      return;
    }

    let cancelled = false;
    const client = wikiClient;
    const wikiId = activeWikiId;
    const parentPath = activePage.path;

    async function loadSubPages() {
      try {
        const children = await client.getChildPages(wikiId, parentPath);
        if (cancelled) {
          return;
        }
        setSubPages(
          [...children]
            .sort((a, b) => a.order - b.order)
            .map((child) => ({ path: child.path, title: pageTitle(child.path) }))
        );
      } catch {
        if (!cancelled) {
          setSubPages([]);
        }
      }
    }

    void loadSubPages();
    return () => { cancelled = true; };
  }, [activePage, activeWikiId, wikiClient]);

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

  const resolveImageSrc = useCallback(
    async (src: string, currentPath: string): Promise<string | undefined> => {
      if (!activeWiki || !projectName) {
        return undefined;
      }

      // Relative attachment (e.g. ".attachments/image.png"): read it from the
      // wiki repo via the Items API. We fetch it with the extension's access
      // token and return a blob: URL rather than setting the API URL as a raw
      // <img src> — a cross-origin image request from the sandboxed extension
      // iframe carries no credentials and comes back 403.
      const path = resolveWikiImagePath(src, currentPath);
      if (path) {
        const itemUrl = buildGitItemUrl(activeWiki, projectName, path);
        return itemUrl ? fetchAsBlob(itemUrl) : undefined;
      }

      // Absolute Azure DevOps CDN attachment: same authenticated fetch.
      if (isAzureDevOpsUrl(src)) {
        return fetchAsBlob(src);
      }

      return undefined;
    },
    [activeWiki, projectName]
  );

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
            subPages={subPages}
            onNavigate={(path) => void loadPageByPath(path, true)}
            onResolveImageSrc={resolveImageSrc}
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

function pageTitle(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

function chooseInitialPage(pages: readonly WikiPageSummary[]): string | undefined {
  return (
    pages.find((page) => page.path === "/Home")?.path ??
    pages.find((page) => page.order === 0)?.path ??
    pages[0]?.path
  );
}
