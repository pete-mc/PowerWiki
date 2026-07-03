import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import * as SDK from "azure-devops-extension-sdk";
import {
  WorkItemTrackingServiceIds,
  type IWorkItemFormNavigationService
} from "azure-devops-extension-api/WorkItemTracking";
import type { HeaderMenuAction } from "../HeaderMenuAction";
import { MarkdownPreview, type WikiSubPage } from "../../rendering/MarkdownPreview";
import { AzureDevOpsWorkItemClient } from "../../workItems/AzureDevOpsWorkItemClient";
import { AzureDevOpsWikiRepositoryClient } from "../../wiki/AzureDevOpsWikiRepositoryClient";
import type { WikiPage, WikiPageSummary, WikiSummary } from "../../wiki/WikiPage";
import { buildWikiPageTree } from "../../wiki/WikiPageTree";
import { StatusMessage } from "./StatusMessage";
import { WikiMovePageDialog } from "./WikiMovePageDialog";
import { WikiPageEditor } from "./WikiPageEditor";
import { WikiPageTree, type WikiPageTreeActions } from "./WikiPageTree";
import { CollapsePanelIcon, ExpandPanelIcon, PlusIcon } from "./WikiPageIcons";
import { WikiSelector } from "./WikiSelector";

interface WikiBrowserProps {
  readonly onHeaderMenuActionsChange?: (actions: readonly HeaderMenuAction[]) => void;
  readonly onPageTitleChange?: (title: string | undefined) => void;
  readonly organizationIsHosted?: boolean;
  readonly organizationName?: string;
  readonly projectName?: string;
}

type LoadState = "failed" | "loading" | "ready";
type SaveState = "failed" | "idle" | "saving";

interface IHostNavigationService {
  getHash(): Promise<string>;
  setHash(hash: string): Promise<void>;
  onHashChanged(callback: (hash: string) => void): void;
}

interface NavigationTarget {
  readonly pagePath: string;
  readonly wikiId?: string;
  readonly wikiName?: string;
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

function normalizeHash(hash: string): string {
  return hash.startsWith("#") ? hash.slice(1) : hash;
}

function normalizePagePath(path: string): string {
  const decoded = safeDecode(path);
  if (!decoded || decoded === "/") {
    return "/";
  }

  return decoded.startsWith("/") ? decoded : `/${decoded}`;
}

function parseNavigationHash(hash: string): NavigationTarget | undefined {
  const normalized = normalizeHash(hash).trim();
  if (!normalized) {
    return undefined;
  }

  const wikiRoutePrefix = "/wikis/";
  if (normalized.startsWith(wikiRoutePrefix)) {
    const remainder = normalized.slice(wikiRoutePrefix.length);
    const slashIndex = remainder.indexOf("/");
    if (slashIndex <= 0) {
      return undefined;
    }

    return {
      pagePath: normalizePagePath(remainder.slice(slashIndex)),
      wikiName: safeDecode(remainder.slice(0, slashIndex))
    };
  }

  const colonIndex = normalized.indexOf(":");
  if (colonIndex > 0 && !normalized.startsWith("/")) {
    const wikiId = normalized.slice(0, colonIndex);
    const rawPath = normalized.slice(colonIndex + 1);
    return { wikiId, pagePath: normalizePagePath(rawPath) };
  }

  return { pagePath: normalizePagePath(normalized) };
}

function buildNavigationHash(wiki: WikiSummary | undefined, pagePath: string, wikis: readonly WikiSummary[]): string {
  const encodedPath = encodeURI(normalizePagePath(pagePath));
  if (!wiki || wikis.length <= 1 || wikis[0]?.id === wiki.id) {
    return encodedPath;
  }

  return `/wikis/${encodeURIComponent(wiki.name)}${encodedPath}`;
}

function setNavigationHash(navService: IHostNavigationService | undefined, hash: string): void {
  if (navService) {
    void navService.setHash(hash);
    return;
  }

  window.location.hash = hash;
}

function findNavigationWikiId(target: NavigationTarget | null, wikis: readonly WikiSummary[]): string | undefined {
  if (!target) {
    return undefined;
  }

  if (target.wikiId && wikis.some((wiki) => wiki.id === target.wikiId)) {
    return target.wikiId;
  }

  if (target.wikiName) {
    return wikis.find((wiki) => wiki.name === target.wikiName)?.id;
  }

  return undefined;
}

function navigationTargetsWiki(target: NavigationTarget | null, wikiId: string, wikis: readonly WikiSummary[]): boolean {
  const targetWikiId = findNavigationWikiId(target, wikis);
  return !targetWikiId || targetWikiId === wikiId;
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

// Azure DevOps serves some wiki attachments (images pasted into the editor) as
// CDN URLs. Hostnames we recognise:
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

function resolveAzureDevOpsImagePath(src: string): string | undefined {
  try {
    const url = new URL(src);
    if (!AZURE_DEVOPS_HOSTNAMES.test(url.hostname)) {
      return undefined;
    }

    return safeDecode(url.pathname);
  } catch {
    return undefined;
  }
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

export function WikiBrowser({
  onHeaderMenuActionsChange,
  onPageTitleChange,
  organizationIsHosted,
  organizationName,
  projectName
}: WikiBrowserProps) {
  const [activePage, setActivePage] = useState<WikiPage>();
  const [activeWikiId, setActiveWikiId] = useState<string>();
  const [draftContent, setDraftContent] = useState("");
  const [error, setError] = useState<string>();
  const [isEditing, setIsEditing] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [moveDialogPath, setMoveDialogPath] = useState<string | undefined>(undefined);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadedPaths, setLoadedPaths] = useState<ReadonlySet<string>>(new Set());
  const [navigationReady, setNavigationReady] = useState(false);
  const [pageList, setPageList] = useState<WikiPageSummary[]>([]);
  const [saveError, setSaveError] = useState<string>();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [subPages, setSubPages] = useState<readonly WikiSubPage[]>([]);
  const [wikis, setWikis] = useState<WikiSummary[]>([]);

  const hasUnsavedChangesRef = useRef(false);
  const savedNavigation = useRef<NavigationTarget | null>(null);
  const navigationServiceRef = useRef<IHostNavigationService | undefined>(undefined);
  // When set, the page with this path should switch into edit mode as soon as it
  // finishes loading. Used by the tree's "Edit" action and new-page creation so
  // the editor opens without a second click.
  const pendingEditPathRef = useRef<string | undefined>(undefined);
  // The last page path we navigated to. Used to ignore onHashChanged events that
  // are echoes of our own setHash() calls, preventing navigation loops.
  const lastNavigatedPathRef = useRef<string | undefined>(undefined);

  const wikiClient = useMemo(() => {
    return projectName ? new AzureDevOpsWikiRepositoryClient(projectName) : undefined;
  }, [projectName]);
  const workItemClient = useMemo(() => {
    return projectName ? new AzureDevOpsWorkItemClient(projectName) : undefined;
  }, [projectName]);
  const activeWiki = useMemo(
    () => wikis.find((wiki) => wiki.id === activeWikiId),
    [activeWikiId, wikis]
  );
  const pageTree = useMemo(
    () => buildWikiPageTree(pageList, loadedPaths),
    [loadedPaths, pageList]
  );
  const hasUnsavedChanges = Boolean(activePage && isEditing && draftContent !== activePage.content);
  const confirmDiscardEdits = useCallback(() => {
    return !hasUnsavedChangesRef.current || window.confirm("Discard unsaved page edits?");
  }, []);
  const startEditing = useCallback(() => {
    if (!activePage) {
      return;
    }

    setDraftContent(activePage.content);
    setSaveError(undefined);
    setSaveState("idle");
    setIsEditing(true);
  }, [activePage]);
  const cancelEditing = useCallback(() => {
    if (!confirmDiscardEdits()) {
      return;
    }

    setDraftContent(activePage?.content ?? "");
    setSaveError(undefined);
    setSaveState("idle");
    setIsEditing(false);
  }, [activePage?.content, confirmDiscardEdits]);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    setDraftContent(activePage?.content ?? "");
    setIsEditing(false);
    setSaveError(undefined);
    setSaveState("idle");
  }, [activePage?.path]);

  // Runs after the reset effect above (declaration order matters): if this page
  // was opened via an "Edit" request, drop straight into the editor.
  useEffect(() => {
    if (activePage && pendingEditPathRef.current === activePage.path) {
      pendingEditPathRef.current = undefined;
      setDraftContent(activePage.content);
      setSaveError(undefined);
      setSaveState("idle");
      setIsEditing(true);
    }
  }, [activePage]);

  useEffect(() => {
    if (!activePage) {
      onHeaderMenuActionsChange?.([]);
      return;
    }

    onHeaderMenuActionsChange?.([
      {
        id: isEditing ? "cancel-edit" : "edit-page",
        label: isEditing ? "Cancel edit" : "Edit page",
        onClick: isEditing ? cancelEditing : startEditing,
      },
    ]);

    return () => {
      onHeaderMenuActionsChange?.([]);
    };
  }, [activePage, cancelEditing, isEditing, onHeaderMenuActionsChange, startEditing]);

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
          if (updateHash) {
            setNavigationHash(
              navigationServiceRef.current,
              buildNavigationHash(activeWiki, page.path, wikis)
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
    [activeWiki, activeWikiId, wikiClient, wikis]
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

    const targetWikiId = findNavigationWikiId(parsed, wikis) ?? activeWikiId;
    if (!targetWikiId) {
      return;
    }

    if (!confirmDiscardEdits()) {
      return;
    }

    // A different (known) wiki was requested via the URL — switch to it and let
    // the page-load effect restore the requested page.
    if (targetWikiId !== activeWikiId) {
      savedNavigation.current = parsed;
      setActiveWikiId(targetWikiId);
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
      const fallbackHash = window.location.hash;
      if (navService) {
        const hash = await navService.getHash();
        savedNavigation.current = parseNavigationHash(hash) ?? parseNavigationHash(fallbackHash) ?? null;
        navService.onHashChanged((changedHash) => {
          hashChangeHandlerRef.current(changedHash);
        });
      } else {
        savedNavigation.current = parseNavigationHash(fallbackHash) ?? null;
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

        const savedWikiId = findNavigationWikiId(savedNavigation.current, availableWikis);
        const targetWikiId =
          savedWikiId
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
        const savedPath = navigationTargetsWiki(saved, wikiId, wikis) ? saved?.pagePath : undefined;
        savedNavigation.current = null;

        // Resolve the initial/deep-linked page, trying hyphen/space variants,
        // then falling back to the wiki home page if the saved path is gone.
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

        const treeState = initialPage
          ? await loadAncestorPageLists(client, wikiId, initialPage.path, rootPages)
          : { loadedPaths: new Set<string>(["/"]), pages: rootPages };

        if (cancelled) return;

        setPageList(treeState.pages);
        setLoadedPaths(treeState.loadedPaths);
        setActivePage(initialPage);
        setLoadState("ready");

        if (initialPage) {
          lastNavigatedPathRef.current = initialPage.path;
          setNavigationHash(
            navigationServiceRef.current,
            buildNavigationHash(activeWiki, initialPage.path, wikis)
          );
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
  }, [activeWiki, activeWikiId, wikiClient, wikis]);

  useEffect(() => {
    if (loadState === "loading" && !activePage) {
      onPageTitleChange?.("Loading wiki");
      return;
    }

    onPageTitleChange?.(activePage ? pageTitle(activePage.path) : undefined);
  }, [activePage, loadState, onPageTitleChange]);

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

  const handleNodeExpand = useCallback(
    async (path: string): Promise<void> => {
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
    },
    [activeWikiId, loadedPaths, wikiClient]
  );

  const handlePageSelected = useCallback(
    async (path: string) => {
      if (!confirmDiscardEdits()) {
        return;
      }

      await loadPageByPath(path, true);
    },
    [confirmDiscardEdits, loadPageByPath]
  );

  // Re-fetches the direct children of the given parent paths and merges them
  // into the flat page list, replacing any stale direct children. Used to keep
  // the tree in sync after a page is created, deleted, or moved.
  const reloadChildrenInto = useCallback(
    async (parents: readonly string[]) => {
      if (!wikiClient || !activeWikiId) {
        return;
      }

      const uniqueParents = Array.from(new Set(parents));
      const results = await Promise.all(
        uniqueParents.map(async (parent) => {
          try {
            return [parent, await wikiClient.getChildPages(activeWikiId, parent)] as const;
          } catch {
            return [parent, [] as WikiPageSummary[]] as const;
          }
        })
      );

      const removedParents = new Set(uniqueParents);
      setPageList((prev) => {
        const kept = prev.filter((page) => !removedParents.has(parentOfPath(page.path)));
        const known = new Set(kept.map((page) => page.path));
        const additions: WikiPageSummary[] = [];
        for (const [, children] of results) {
          for (const child of children) {
            if (!known.has(child.path)) {
              additions.push(child);
              known.add(child.path);
            }
          }
        }
        return [...kept, ...additions];
      });
      setLoadedPaths((prev) => new Set([...prev, ...uniqueParents]));
    },
    [activeWikiId, wikiClient]
  );

  const handleCreatePage = useCallback(
    async (parentPath: string) => {
      if (!wikiClient || !activeWikiId || !confirmDiscardEdits()) {
        return;
      }

      const title = window.prompt("New page title")?.trim();
      if (!title) {
        return;
      }

      const newPath = parentPath === "/" ? `/${title}` : `${parentPath}/${title}`;
      try {
        await wikiClient.createPage(activeWikiId, newPath, "");
        await reloadChildrenInto(parentPath === "/" ? ["/"] : [parentPath, "/"]);
        pendingEditPathRef.current = newPath;
        await loadPageByPath(newPath, true);
      } catch (createError: unknown) {
        window.alert(`Could not create page: ${formatError(createError)}`);
      }
    },
    [activeWikiId, confirmDiscardEdits, loadPageByPath, reloadChildrenInto, wikiClient]
  );

  const handleEditPage = useCallback(
    async (path: string) => {
      if (activePage?.path === path) {
        startEditing();
        return;
      }

      if (!confirmDiscardEdits()) {
        return;
      }

      pendingEditPathRef.current = path;
      await loadPageByPath(path, true);
    },
    [activePage?.path, confirmDiscardEdits, loadPageByPath, startEditing]
  );

  const handleDeletePage = useCallback(
    async (path: string) => {
      if (!wikiClient || !activeWikiId) {
        return;
      }

      if (!window.confirm(`Delete "${pageTitle(path)}" and any of its sub-pages?`)) {
        return;
      }

      try {
        await wikiClient.deletePage(activeWikiId, path);
        const parent = parentOfPath(path);
        await reloadChildrenInto([parent]);

        // If the deleted page (or one of its descendants) was open, fall back to
        // its parent, or the wiki home page when the parent is the root.
        if (activePage && (activePage.path === path || activePage.path.startsWith(`${path}/`))) {
          if (parent !== "/") {
            await loadPageByPath(parent, true);
          } else {
            setActivePage(undefined);
          }
        }
      } catch (deleteError: unknown) {
        window.alert(`Could not delete page: ${formatError(deleteError)}`);
      }
    },
    [activePage, activeWikiId, loadPageByPath, reloadChildrenInto, wikiClient]
  );

  const performMove = useCallback(
    async (sourcePath: string, newPath: string, newOrder: number) => {
      if (!wikiClient || !activeWikiId) {
        return;
      }

      try {
        await wikiClient.movePage(activeWikiId, sourcePath, newPath, newOrder);

        // Drop the moved subtree's stale entries; the reloads below re-add the
        // page under its new parent and lazily re-fetch its children.
        const isMoved = (candidate: string) =>
          candidate === sourcePath || candidate.startsWith(`${sourcePath}/`);
        setPageList((prev) => prev.filter((page) => !isMoved(page.path)));
        setLoadedPaths((prev) => new Set([...prev].filter((entry) => !isMoved(entry))));

        await reloadChildrenInto([parentOfPath(sourcePath), parentOfPath(newPath)]);

        // Follow the active page if it moved along with the dragged subtree.
        if (activePage && isMoved(activePage.path)) {
          const followedPath = newPath + activePage.path.slice(sourcePath.length);
          await loadPageByPath(followedPath, true);
        }
      } catch (moveError: unknown) {
        window.alert(`Could not move page: ${formatError(moveError)}`);
      }
    },
    [activePage, activeWikiId, loadPageByPath, reloadChildrenInto, wikiClient]
  );

  const handleOpenMoveDialog = useCallback(
    (path: string) => {
      if (!confirmDiscardEdits()) {
        return;
      }
      setMoveDialogPath(path);
    },
    [confirmDiscardEdits]
  );

  const handleConfirmMove = useCallback(
    async (destinationParent: string) => {
      const sourcePath = moveDialogPath;
      setMoveDialogPath(undefined);
      if (!sourcePath) {
        return;
      }

      const name = sourcePath.split("/").filter(Boolean).at(-1) ?? sourcePath;
      const newPath = destinationParent === "/" ? `/${name}` : `${destinationParent}/${name}`;
      if (newPath === sourcePath) {
        return;
      }

      // Append the page to the end of the destination's known children.
      const newOrder = pageList.filter((page) => parentOfPath(page.path) === destinationParent).length;
      await performMove(sourcePath, newPath, newOrder);
    },
    [moveDialogPath, pageList, performMove]
  );

  const treeActions = useMemo<WikiPageTreeActions>(
    () => ({
      onAddSubPage: (path) => void handleCreatePage(path),
      onDeletePage: (path) => void handleDeletePage(path),
      onEditPage: (path) => void handleEditPage(path),
      onMoveNode: (sourcePath, newPath, newOrder) => void performMove(sourcePath, newPath, newOrder),
      onMovePage: handleOpenMoveDialog,
      onNodeExpand: (path) => void handleNodeExpand(path),
      onPageSelected: (path) => void handlePageSelected(path),
    }),
    [handleCreatePage, handleDeletePage, handleEditPage, handleNodeExpand, handleOpenMoveDialog, handlePageSelected, performMove]
  );

  async function handleSavePage() {
    if (!wikiClient || !activeWikiId || !activePage) {
      return;
    }

    setSaveError(undefined);
    setSaveState("saving");

    try {
      const savedPage = await wikiClient.savePage(activeWikiId, {
        ...activePage,
        content: draftContent,
      });
      setActivePage(savedPage);
      setDraftContent(savedPage.content);
      setIsEditing(false);
      setSaveState("idle");
    } catch (saveFailure: unknown) {
      setSaveState("failed");
      setSaveError(formatError(saveFailure));
    }
  }

  const resolveImageSrc = useCallback(
    (src: string, currentPath: string): string | undefined => {
      if (!activeWiki || !projectName) {
        return undefined;
      }

      const path = resolveWikiImagePath(src, currentPath);
      if (path) {
        return buildGitItemUrl(activeWiki, projectName, path);
      }

      if (isAzureDevOpsUrl(src)) {
        const azureDevOpsPath = resolveAzureDevOpsImagePath(src);
        return azureDevOpsPath
          ? buildGitItemUrl(activeWiki, projectName, azureDevOpsPath)
          : undefined;
      }

      return undefined;
    },
    [activeWiki, projectName]
  );
  const loadQueryTable = useCallback(
    async (queryId: string) => {
      if (!workItemClient) {
        throw new Error("PowerWiki needs an Azure DevOps project context to load queries.");
      }

      const result = await workItemClient.getQueryTable(queryId);
      return {
        ...result,
        nativeUrl: buildAzureDevOpsQueryUrl(organizationName, projectName, organizationIsHosted, queryId)
      };
    },
    [organizationIsHosted, organizationName, projectName, workItemClient]
  );
  const loadWorkItemBadge = useCallback(
    async (id: number) => {
      if (!workItemClient) {
        throw new Error("PowerWiki needs an Azure DevOps project context to load work items.");
      }

      return workItemClient.getWorkItemBadgeDetails(id);
    },
    [workItemClient]
  );
  const openWorkItem = useCallback(
    async (id: number) => {
      try {
        const navigationService = await SDK.getService<IWorkItemFormNavigationService>(
          WorkItemTrackingServiceIds.WorkItemFormNavigationService
        );
        await navigationService.openWorkItem(id);
      } catch {
        const workItemUrl = buildAzureDevOpsWorkItemUrl(organizationName, projectName, organizationIsHosted, id);
        if (workItemUrl) {
          window.open(workItemUrl, "_blank", "noopener,noreferrer");
        }
      }
    },
    [organizationIsHosted, organizationName, projectName]
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
    <>
      <aside
        aria-label="Wiki pages"
        className={navCollapsed ? "powerwiki-nav collapsed" : "powerwiki-nav"}
      >
        {navCollapsed ? (
          <button
            aria-label="Expand navigation panel"
            className="powerwiki-nav-expand"
            onClick={() => setNavCollapsed(false)}
            type="button"
          >
            <ExpandPanelIcon />
          </button>
        ) : (
          <>
            <WikiSelector
              activeWikiId={activeWikiId}
              disabled={loadState === "loading"}
              onWikiSelected={(wikiId) => {
                if (!confirmDiscardEdits()) {
                  return;
                }

                savedNavigation.current = null;
                setActiveWikiId(wikiId);
              }}
              wikis={wikis}
            />
            <div className="powerwiki-nav-tree">
              <WikiPageTree
                actions={treeActions}
                activePath={activePage?.path}
                isLoading={loadState === "loading" && pageTree.length === 0}
                nodes={pageTree}
              />
            </div>
            <div className="powerwiki-nav-footer">
              <button
                className="powerwiki-new-page"
                disabled={loadState === "loading" || !activeWikiId}
                onClick={() => void handleCreatePage("/")}
                type="button"
              >
                <PlusIcon />
                <span>New page</span>
              </button>
              <button
                aria-label="Collapse navigation panel"
                className="powerwiki-nav-collapse"
                onClick={() => setNavCollapsed(true)}
                type="button"
              >
                <CollapsePanelIcon />
              </button>
            </div>
          </>
        )}
      </aside>

      <article className="powerwiki-content">
        {activePage && isEditing ? (
          <section className="wiki-editor-shell" aria-label={`Editing ${pageTitle(activePage.path)}`}>
            <div className="wiki-editor-toolbar">
              <div>
                <strong>{pageTitle(activePage.path)}</strong>
                <span>{hasUnsavedChanges ? "Unsaved changes" : "No changes"}</span>
              </div>
              <div className="wiki-editor-toolbar-actions">
                <button
                  disabled={saveState === "saving" || !hasUnsavedChanges}
                  onClick={() => void handleSavePage()}
                  type="button"
                >
                  {saveState === "saving" ? "Saving" : "Save"}
                </button>
                <button
                  disabled={saveState === "saving"}
                  onClick={cancelEditing}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
            {saveState === "failed" && saveError ? (
              <p className="wiki-editor-error" role="alert">{saveError}</p>
            ) : null}
            <WikiPageEditor
              disabled={saveState === "saving"}
              onChange={setDraftContent}
              value={draftContent}
            />
          </section>
        ) : activePage ? (
          <MarkdownPreview
            markdown={activePage.content}
            currentPath={activePage.path}
            subPages={subPages}
            onLoadQueryTable={loadQueryTable}
            onLoadWorkItemBadge={loadWorkItemBadge}
            onNavigate={(path) => {
              if (confirmDiscardEdits()) {
                void loadPageByPath(path, true);
              }
            }}
            onOpenWorkItem={(id) => void openWorkItem(id)}
            onResolveImageSrc={resolveImageSrc}
          />
        ) : (
          <StatusMessage
            message={loadState === "loading" ? "Loading wiki content." : "Select a page to view it."}
            title={loadState === "loading" ? "Loading" : "No page selected"}
          />
        )}
      </article>

      {moveDialogPath ? (
        <WikiMovePageDialog
          homePath={pageTree[0]?.path}
          movingPath={moveDialogPath}
          nodes={pageTree}
          onCancel={() => setMoveDialogPath(undefined)}
          onConfirm={(destinationParent) => void handleConfirmMove(destinationParent)}
          onExpand={(path) => void handleNodeExpand(path)}
        />
      ) : null}
    </>
  );
}

function buildAzureDevOpsQueryUrl(
  organizationName: string | undefined,
  projectName: string | undefined,
  isHosted: boolean | undefined,
  queryId: string
): string | undefined {
  if (!organizationName || !projectName || !isHosted) {
    return undefined;
  }

  return `https://dev.azure.com/${encodeURIComponent(organizationName)}/${encodeURIComponent(projectName)}/_queries/query/${encodeURIComponent(queryId)}/`;
}

function buildAzureDevOpsWorkItemUrl(
  organizationName: string | undefined,
  projectName: string | undefined,
  isHosted: boolean | undefined,
  id: number
): string | undefined {
  if (!organizationName || !projectName || !isHosted) {
    return undefined;
  }

  return `https://dev.azure.com/${encodeURIComponent(organizationName)}/${encodeURIComponent(projectName)}/_workitems/edit/${id}/`;
}

function parentOfPath(path: string): string {
  const segments = normalizePagePath(path).split("/").filter(Boolean);
  if (segments.length <= 1) {
    return "/";
  }
  return "/" + segments.slice(0, -1).join("/");
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

interface WikiPageListLoader {
  getChildPages(wikiId: string, path: string): Promise<WikiPageSummary[]>;
}

async function loadAncestorPageLists(
  client: WikiPageListLoader,
  wikiId: string,
  targetPath: string,
  rootPages: readonly WikiPageSummary[]
): Promise<{ loadedPaths: Set<string>; pages: WikiPageSummary[] }> {
  const loadedPaths = new Set<string>(["/"]);
  const pagesByPath = new Map(rootPages.map((page) => [page.path, page]));

  for (const ancestorPath of ancestorPaths(targetPath)) {
    try {
      const children = await client.getChildPages(wikiId, ancestorPath);
      loadedPaths.add(ancestorPath);
      for (const child of children) {
        pagesByPath.set(child.path, child);
      }
    } catch {
      loadedPaths.add(ancestorPath);
    }
  }

  return { loadedPaths, pages: Array.from(pagesByPath.values()) };
}

function ancestorPaths(path: string): string[] {
  const segments = normalizePagePath(path).split("/").filter(Boolean);
  const ancestors: string[] = [];

  for (let index = 1; index < segments.length; index += 1) {
    ancestors.push("/" + segments.slice(0, index).join("/"));
  }

  return ancestors;
}
