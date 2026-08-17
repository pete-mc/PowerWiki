import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import * as SDK from "azure-devops-extension-sdk";
import {
  WorkItemTrackingServiceIds,
  type IWorkItemFormNavigationService
} from "azure-devops-extension-api/WorkItemTracking";
import type { HeaderMenuAction } from "../HeaderMenuAction";
import { ErrorBoundary } from "../ErrorBoundary";
import { useThemeMode } from "../themeMode";
import { MarkdownPreview, type WikiSubPage } from "../../rendering/MarkdownPreview";
import { buildAttachmentName, fileToBase64, isImageFile, type AttachmentUploadResult } from "../../wiki/attachmentUpload";
import { fetchAttachmentDataUrl, fetchAttachmentObjectUrl } from "../../wiki/attachmentImage";
import { DrawioEditorDialog, type DrawioEditorTarget } from "../../drawio/DrawioEditorDialog";
import {
  countDiagramReferences,
  dataUrlToBase64,
  newDiagramName,
  nextDiagramName,
} from "../../drawio/drawioDiagram";
import { AzureDevOpsIdentityClient } from "../../identity/AzureDevOpsIdentityClient";
import { AzureDevOpsWorkItemClient } from "../../workItems/AzureDevOpsWorkItemClient";
import { AzureDevOpsWikiRepositoryClient } from "../../wiki/AzureDevOpsWikiRepositoryClient";
import type { WikiRepositoryClient } from "../../wiki/WikiRepositoryClient";
import { resolveWithinTimeout } from "./hostServiceTimeout";
import type { WikiPage, WikiPageSummary, WikiSummary } from "../../wiki/WikiPage";
import { buildWikiPageTree } from "../../wiki/WikiPageTree";
import type { WikiComment, WikiPageChange, WikiPageMeta, WikiPageRevision } from "../../wiki/WikiComment";
import { clearDraft, loadDraft, saveDraft, type StoredDraft } from "./draftStore";
import { loadAllWikiPages, type IndexedWikiPage } from "./wikiContentIndex";
import { searchWiki, type SearchTransport, type WikiSearchOutcome } from "../../wiki/wikiSearch";
import { azureDevOpsWikiSearchTransport } from "../../wiki/wikiSearchTransport";
import { rewriteWikiLinks } from "../../wiki/wikiLinkRewrite";
import { WikiAttachmentsDialog } from "./WikiAttachmentsDialog";
import { WikiExportDialog } from "./WikiExportDialog";
import { WikiHistoryDialog } from "./WikiHistoryDialog";
import { WikiFollowClient } from "../../wiki/followClient";
import { WikiLinkUpdateDialog, type InboundLinkUpdate } from "./WikiLinkUpdateDialog";
import { toExportImage } from "../../export/imageMeta";
import type { ExportImage } from "../../export/types";
import { buildHubPageUrl, splitHashAnchor, withHashAnchor } from "./wikiHeadingLink";
import { StatusMessage } from "./StatusMessage";
import { WikiCommentsPanel } from "./WikiCommentsPanel";
import { WikiRichTextEditor } from "./WikiRichTextEditor";
import { WikiMovePageDialog } from "./WikiMovePageDialog";
import type { WikiPageBylineProps } from "./WikiPageByline";
import { WikiPageEditor, type WikiPageLink } from "./WikiPageEditor";
import { WikiPageTree, type WikiPageTreeActions } from "./WikiPageTree";
import { WikiSearchResults } from "./WikiSearchResults";
import { filterWikiPageTree } from "./wikiTreeFilter";
import { CollapsePanelIcon, ExpandPanelIcon, PlusIcon } from "./WikiPageIcons";
import { WikiSelector } from "./WikiSelector";

interface WikiBrowserProps {
  readonly contributionId?: string;
  readonly onHeaderMenuActionsChange?: (actions: readonly HeaderMenuAction[]) => void;
  readonly onPageBylineChange?: (byline: WikiPageBylineProps | undefined) => void;
  readonly onPageTitleChange?: (title: string | undefined) => void;
  readonly organizationIsHosted?: boolean;
  readonly organizationName?: string;
  readonly projectId?: string;
  readonly projectName?: string;
  /**
   * How a wiki search request reaches the network. Defaults to the real
   * token-authenticated transport; the sandbox injects an in-memory one so the
   * search box works with no organization and no SDK.
   */
  readonly searchTransport?: SearchTransport;
  /**
   * The full-text query, owned by the search bar in the header (see App). Its
   * results render into the content area, so the query has to cross from the
   * header down to here; the tree's name filter is separate and stays local.
   */
  readonly searchQuery?: string;
  readonly onSearchQueryChange?: (query: string) => void;
  readonly userId?: string;
  /**
   * Wiki data access. Defaults to the real Azure DevOps REST client for the
   * current project; the local sandbox injects an in-memory fake so the UI can
   * run with no organization and no sign-in. Only this client is injectable —
   * follow, work-item, and identity access go through host services that are
   * absent outside a real hub, so those features degrade rather than being faked.
   */
  readonly wikiClient?: WikiRepositoryClient;
}

// The page-tree rail is user-resizable so long page names stay readable. The
// chosen width persists locally (it is a per-person display preference, not
// wiki content, so it does not belong in the repository).
const NAV_WIDTH_KEY = "powerwiki:navWidth";
const NAV_WIDTH_DEFAULT = 240;
const NAV_WIDTH_MIN = 180;
const NAV_WIDTH_MAX = 640;

function clampNavWidth(width: number): number {
  return Math.round(Math.max(NAV_WIDTH_MIN, Math.min(NAV_WIDTH_MAX, width)));
}

function readStoredNavWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(NAV_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampNavWidth(stored) : NAV_WIDTH_DEFAULT;
  } catch {
    return NAV_WIDTH_DEFAULT;
  }
}

type LoadState = "failed" | "loading" | "ready";
type SaveState = "failed" | "idle" | "saving";
type EditMode = "code" | "richText" | "splitCode";

interface IHostNavigationService {
  getHash(): Promise<string>;
  setHash(hash: string): Promise<void>;
  onHashChanged(callback: (hash: string) => void): void;
  setDocumentTitle(title: string): void;
}

interface NavigationTarget {
  readonly pagePath: string;
  readonly wikiId?: string;
  readonly wikiName?: string;
  /** Heading slug to scroll to after the page loads, from an &anchor= marker. */
  readonly anchor?: string;
}

const HOST_NAVIGATION_SERVICE_ID = "ms.vss-features.host-navigation-service";
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// Matches the Azure DevOps table-of-subpages placeholder in page content so we
// only fetch child pages for pages that actually use it.
const TOSP_PLACEHOLDER = /\[\[_?TOSP_?\]\]/i;

// A real host answers in milliseconds; this only has to be short enough that a
// stalled host degrades to hash-based navigation rather than hanging.
const HOST_NAVIGATION_TIMEOUT_MS = 3000;

/**
 * The host navigation service, or undefined when the host does not supply one.
 *
 * `SDK.getService()` only *rejects* on an explicit failure. If the host handshake
 * never completes — which is the normal case outside a real hub iframe, such as
 * the local sandbox — the promise simply never settles. This call is on the
 * critical path to loading the wiki (see the `navigationReady` gate below), so an
 * unbounded await shows a permanent "Loading wiki." with no error and no way out,
 * even though the caller already knows how to fall back to `window.location.hash`.
 * Time out so that fallback is actually reachable.
 */
function getNavigationService(): Promise<IHostNavigationService | undefined> {
  return resolveWithinTimeout(
    SDK.getService<IHostNavigationService>(HOST_NAVIGATION_SERVICE_ID),
    HOST_NAVIGATION_TIMEOUT_MS
  );
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

/** Display title for a wiki page: its last path segment (root page -> "Home"). */
function pageTitleFromPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : "Home";
}

/** Human-friendly relative time for an autosaved draft ("3 minutes ago"). */
function formatDraftTime(savedAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
  if (seconds < 45) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  try {
    return new Date(savedAt).toLocaleString();
  } catch {
    return "earlier";
  }
}

function parseNavigationHash(hash: string): NavigationTarget | undefined {
  const { pageHash, anchor } = splitHashAnchor(normalizeHash(hash));
  const normalized = pageHash.trim();
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
      anchor,
      pagePath: normalizePagePath(remainder.slice(slashIndex)),
      wikiName: safeDecode(remainder.slice(0, slashIndex))
    };
  }

  const colonIndex = normalized.indexOf(":");
  if (colonIndex > 0 && !normalized.startsWith("/")) {
    const wikiId = normalized.slice(0, colonIndex);
    const rawPath = normalized.slice(colonIndex + 1);
    return { anchor, wikiId, pagePath: normalizePagePath(rawPath) };
  }

  return { anchor, pagePath: normalizePagePath(normalized) };
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
  contributionId,
  onHeaderMenuActionsChange,
  onPageBylineChange,
  onPageTitleChange,
  organizationIsHosted,
  organizationName,
  projectId,
  projectName,
  onSearchQueryChange,
  searchQuery = "",
  searchTransport,
  userId,
  wikiClient: injectedWikiClient
}: WikiBrowserProps) {
  const [activePage, setActivePage] = useState<WikiPage>();
  // Heading slug to scroll to once the active page renders (from an &anchor=
  // deep link or a heading permalink click). Cleared on ordinary navigation.
  const [activeAnchor, setActiveAnchor] = useState<string | undefined>(undefined);
  // An autosaved draft found for the active page that differs from its saved
  // content, offered for recovery after an accidental reload.
  const [recoverableDraft, setRecoverableDraft] = useState<StoredDraft | undefined>(undefined);
  const [exportOpen, setExportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  // Follow state for the active page: undefined = unknown/loading, null = not
  // following, string = the follow subscription's id.
  const [followSubscriptionId, setFollowSubscriptionId] = useState<string | null | undefined>(undefined);
  const [followBusy, setFollowBusy] = useState(false);
  // Pending inbound-link rewrites after a rename/move, awaiting user confirm.
  const [linkUpdatePlan, setLinkUpdatePlan] = useState<
    { oldPath: string; newPath: string; updates: readonly InboundLinkUpdate[] } | undefined
  >(undefined);
  const [linkUpdateBusy, setLinkUpdateBusy] = useState(false);
  // The draw.io editor dialog: the diagram being edited (or {} for a new one),
  // plus its save/error state. Absent when the editor is closed.
  const [diagramTarget, setDiagramTarget] = useState<DrawioEditorTarget | undefined>(undefined);
  const [diagramBusy, setDiagramBusy] = useState(false);
  const [diagramError, setDiagramError] = useState<string | undefined>(undefined);
  const [diagramStatus, setDiagramStatus] = useState<string | undefined>(undefined);
  // Set while the editor toolbar is waiting for a new diagram: resolved with the
  // uploaded attachment so the Markdown editor can insert it at the cursor.
  const pendingDiagramRef = useRef<((result: AttachmentUploadResult | undefined) => void) | undefined>(undefined);
  // Session cache of every page's content, for the rename inbound-link scan
  // (rebuilt when stale).
  const contentIndexRef = useRef<{ wikiId: string; pages: readonly IndexedWikiPage[]; builtAt: number } | undefined>(
    undefined
  );
  const themeMode = useThemeMode();
  const [activeWikiId, setActiveWikiId] = useState<string>();
  const [draftContent, setDraftContent] = useState("");
  const [error, setError] = useState<string>();
  const [editMode, setEditMode] = useState<EditMode>("code");
  const [isEditing, setIsEditing] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [navWidth, setNavWidth] = useState(readStoredNavWidth);
  const [moveDialogPath, setMoveDialogPath] = useState<string | undefined>(undefined);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadedPaths, setLoadedPaths] = useState<ReadonlySet<string>>(new Set());
  const [navigationReady, setNavigationReady] = useState(false);
  const [pageList, setPageList] = useState<WikiPageSummary[]>([]);
  const [saveError, setSaveError] = useState<string>();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [subPages, setSubPages] = useState<readonly WikiSubPage[]>([]);
  const [wikis, setWikis] = useState<WikiSummary[]>([]);
  const [pageMeta, setPageMeta] = useState<WikiPageMeta>();
  const [pageChange, setPageChange] = useState<WikiPageChange>();
  const [pageChangeLoading, setPageChangeLoading] = useState(false);
  const [comments, setComments] = useState<readonly WikiComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string>();
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [splitRatio, setSplitRatio] = useState(56);
  // Non-empty means the nav rail is showing search results instead of the tree.
  const [treeFilter, setTreeFilter] = useState("");

  const hasUnsavedChangesRef = useRef(false);
  const savedNavigation = useRef<NavigationTarget | null>(null);
  const navigationServiceRef = useRef<IHostNavigationService | undefined>(undefined);
  const contentRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const splitShellRef = useRef<HTMLDivElement>(null);
  // When set, the page with this path should switch into edit mode as soon as it
  // finishes loading. Used by the tree's "Edit" action and new-page creation so
  // the editor opens without a second click.
  const pendingEditPathRef = useRef<string | undefined>(undefined);
  // Always points at the current handleRenamePage so the header menu (built
  // earlier in this component) can dispatch a rename without a forward reference.
  const renamePageRef = useRef<(path: string) => void>(() => {});
  // The last page path we navigated to. Used to ignore onHashChanged events that
  // are echoes of our own setHash() calls, preventing navigation loops.
  const lastNavigatedPathRef = useRef<string | undefined>(undefined);

  const wikiClient = useMemo(() => {
    if (injectedWikiClient) {
      return injectedWikiClient;
    }
    return projectName ? new AzureDevOpsWikiRepositoryClient(projectName) : undefined;
  }, [injectedWikiClient, projectName]);
  const followClient = useMemo(() => new WikiFollowClient(), []);
  const workItemClient = useMemo(() => {
    return projectName ? new AzureDevOpsWorkItemClient(projectName) : undefined;
  }, [projectName]);
  // Mentions resolve through a host service rather than a REST client, so this
  // works in any project context.
  const identityClient = useMemo(() => new AzureDevOpsIdentityClient(), []);
  // Content search runs against the Azure DevOps Search service, which indexes
  // the same wikis the built-in search covers — the alternative, downloading
  // every page and searching in the browser, costs one request per page and does
  // not scale. It needs the organization and project from the host context; with
  // neither, the search box still matches page titles locally rather than
  // failing.
  const searchContent = useMemo(() => {
    if (!organizationName || !projectName) {
      return undefined;
    }

    const transport = searchTransport ?? azureDevOpsWikiSearchTransport;
    return (searchText: string): Promise<WikiSearchOutcome> =>
      searchWiki({ organizationName, projectName, searchText }, transport);
  }, [organizationName, projectName, searchTransport]);
  const activeWiki = useMemo(
    () => wikis.find((wiki) => wiki.id === activeWikiId),
    [activeWikiId, wikis]
  );
  const pageTree = useMemo(
    () => buildWikiPageTree(pageList, loadedPaths),
    [loadedPaths, pageList]
  );
  const filteredPageTree = useMemo(
    () => filterWikiPageTree(pageTree, treeFilter),
    [pageTree, treeFilter]
  );
  const pageLinks = useMemo<readonly WikiPageLink[]>(
    () =>
      pageList
        .map((page) => ({ path: page.path, title: pageTitleFromPath(page.path) }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    [pageList]
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
    setEditMode("code");
    setSaveError(undefined);
    setSaveState("idle");
    setIsEditing(true);
  }, [activePage]);
  const cancelEditing = useCallback(() => {
    if (!confirmDiscardEdits()) {
      return;
    }

    // Discarding the edit also discards its autosaved draft.
    if (activeWikiId && activePage) {
      clearDraft(activeWikiId, activePage.path);
    }
    setRecoverableDraft(undefined);
    setDraftContent(activePage?.content ?? "");
    setSaveError(undefined);
    setSaveState("idle");
    setIsEditing(false);
  }, [activePage, activeWikiId, confirmDiscardEdits]);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  // Native guard for browser refresh/close/navigation (the in-app confirm only
  // covers navigation inside PowerWiki). The prompt text is browser-controlled.
  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

  // Autosave the in-progress edit locally (debounced) so it survives a reload.
  useEffect(() => {
    if (!isEditing || !activeWikiId || !activePage || draftContent === activePage.content) {
      return;
    }

    const wikiId = activeWikiId;
    const path = activePage.path;
    const timer = window.setTimeout(() => saveDraft(wikiId, path, draftContent), 800);
    return () => window.clearTimeout(timer);
  }, [activePage, activeWikiId, draftContent, isEditing]);

  // On opening a page, surface any autosaved draft that differs from the saved
  // content; drop a stale draft that already matches.
  useEffect(() => {
    if (!activeWikiId || !activePage) {
      setRecoverableDraft(undefined);
      return;
    }

    const draft = loadDraft(activeWikiId, activePage.path);
    if (draft && draft.content !== activePage.content) {
      setRecoverableDraft(draft);
    } else {
      if (draft) {
        clearDraft(activeWikiId, activePage.path);
      }
      setRecoverableDraft(undefined);
    }
  }, [activePage, activeWikiId]);

  const restoreDraft = useCallback(() => {
    if (!recoverableDraft) {
      return;
    }

    setDraftContent(recoverableDraft.content);
    setEditMode("code");
    setSaveError(undefined);
    setSaveState("idle");
    setIsEditing(true);
    setRecoverableDraft(undefined);
  }, [recoverableDraft]);

  const discardDraft = useCallback(() => {
    if (activeWikiId && activePage) {
      clearDraft(activeWikiId, activePage.path);
    }
    setRecoverableDraft(undefined);
  }, [activePage, activeWikiId]);

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
      setEditMode("code");
      setSaveError(undefined);
      setSaveState("idle");
      setIsEditing(true);
    }
  }, [activePage]);

  // Loads a page's raw Markdown for export (may be a page other than the active one).
  const loadPageContent = useCallback(
    async (path: string): Promise<string> => {
      if (!wikiClient || !activeWikiId) {
        return "";
      }
      const page = await wikiClient.getPage(activeWikiId, path);
      return page.content;
    },
    [activeWikiId, wikiClient]
  );

  // Lists the active page's revisions from its Git history (newest first).
  const loadPageRevisions = useCallback(async (): Promise<readonly WikiPageRevision[]> => {
    if (!wikiClient || !activeWiki?.repositoryId || !pageMeta?.gitItemPath) {
      return [];
    }
    return wikiClient.getPageRevisions(activeWiki.repositoryId, pageMeta.gitItemPath, activeWiki.version);
  }, [activeWiki, pageMeta?.gitItemPath, wikiClient]);

  // Reads the page's Markdown as it was at a given revision.
  const loadRevisionContent = useCallback(
    async (revision: WikiPageRevision): Promise<string> => {
      if (!wikiClient || !activeWiki?.repositoryId) {
        throw new Error("Wiki repository unavailable.");
      }
      return wikiClient.getPageContentAtCommit(activeWiki.repositoryId, revision.gitItemPath, revision.commitId);
    },
    [activeWiki, wikiClient]
  );

  // Restoring opens the editor with the historical content as the draft, so the
  // user reviews and saves through the normal path (nothing is written blindly).
  const handleRestoreRevision = useCallback(
    (content: string) => {
      if (!activePage) {
        return;
      }
      setDraftContent(content);
      setEditMode("code");
      setSaveError(undefined);
      setSaveState("idle");
      setIsEditing(true);
    },
    [activePage]
  );

  // Returns the wiki-wide content index, rebuilding it when missing or stale.
  const ensureContentIndex = useCallback(async (): Promise<readonly IndexedWikiPage[]> => {
    if (!wikiClient || !activeWikiId) {
      return [];
    }
    const cached = contentIndexRef.current;
    if (cached && cached.wikiId === activeWikiId && Date.now() - cached.builtAt < 60000) {
      return cached.pages;
    }
    const pages = await loadAllWikiPages(wikiClient, activeWikiId);
    contentIndexRef.current = { wikiId: activeWikiId, pages, builtAt: Date.now() };
    return pages;
  }, [activeWikiId, wikiClient]);

  const invalidateContentIndex = useCallback(() => {
    contentIndexRef.current = undefined;
  }, []);

  // Query whether the current user follows the active page (parity #20).
  useEffect(() => {
    setFollowSubscriptionId(undefined);
    if (!projectId || !userId || !activeWikiId || !pageMeta?.id) {
      return;
    }

    let cancelled = false;
    const target = { projectId, wikiId: activeWikiId, pageId: pageMeta.id, userId };
    followClient
      .getFollowSubscription(target)
      .then((subscriptionId) => {
        if (!cancelled) {
          setFollowSubscriptionId(subscriptionId ?? null);
        }
      })
      .catch(() => {
        // Leave as unknown: the menu entry stays disabled rather than lying.
      });
    return () => {
      cancelled = true;
    };
  }, [activeWikiId, followClient, pageMeta?.id, projectId, userId]);

  const toggleFollow = useCallback(async () => {
    if (!projectId || !userId || !activeWikiId || !pageMeta?.id || followSubscriptionId === undefined) {
      return;
    }
    setFollowBusy(true);
    try {
      if (followSubscriptionId === null) {
        const target = { projectId, wikiId: activeWikiId, pageId: pageMeta.id, userId };
        const created = await followClient.follow(target);
        setFollowSubscriptionId(created);
      } else {
        await followClient.unfollow(followSubscriptionId);
        setFollowSubscriptionId(null);
      }
    } catch (followError: unknown) {
      window.alert(`Could not update follow: ${formatError(followError)}`);
    } finally {
      setFollowBusy(false);
    }
  }, [activeWikiId, followClient, followSubscriptionId, pageMeta?.id, projectId, userId]);

  // Lists the wiki's stored attachments (for the editor picker and the dialog).
  const listWikiAttachments = useCallback(async () => {
    if (!wikiClient || !activeWiki?.repositoryId) {
      return [];
    }
    return wikiClient.listAttachments(activeWiki.repositoryId, activeWiki.mappedPath);
  }, [activeWiki, wikiClient]);

  // After a rename/move, finds pages whose links point at the old path and asks
  // the user to update them (nothing is rewritten without confirmation).
  const scanInboundLinks = useCallback(
    async (oldPath: string, newPath: string) => {
      if (!wikiClient || !activeWikiId) {
        return;
      }
      try {
        invalidateContentIndex();
        const pages = await ensureContentIndex();
        const updates = pages
          .map((page) => ({ path: page.path, count: rewriteWikiLinks(page.content, oldPath, newPath).count }))
          .filter((update) => update.count > 0);
        if (updates.length > 0) {
          setLinkUpdatePlan({ oldPath, newPath, updates });
        }
      } catch {
        // Best-effort: a failed scan should never block the move itself.
      }
    },
    [activeWikiId, ensureContentIndex, invalidateContentIndex, wikiClient]
  );

  // Resolves a Markdown image reference to raw bytes for embedding in an export.
  const loadExportImage = useCallback(
    async (src: string, pagePath: string): Promise<ExportImage | null> => {
      if (!src) {
        return null;
      }
      try {
        if (HAS_SCHEME.test(src) || src.startsWith("//")) {
          const response = await fetch(src.startsWith("//") ? `https:${src}` : src);
          if (!response.ok) {
            return null;
          }
          return await toExportImage(new Uint8Array(await response.arrayBuffer()), src);
        }
        if (!wikiClient || !activeWiki?.repositoryId) {
          return null;
        }
        const wikiPath = resolveWikiImagePath(src, pagePath);
        if (!wikiPath) {
          return null;
        }
        const repoPath = joinRepositoryPath(activeWiki.mappedPath, wikiPath);
        const bytes = await wikiClient.getItemBytes(activeWiki.repositoryId, repoPath);
        return await toExportImage(new Uint8Array(bytes), wikiPath);
      } catch {
        return null;
      }
    },
    [activeWiki, wikiClient]
  );

  const applySplitRatioFromPointer = useCallback((clientX: number) => {
    const shell = splitShellRef.current;
    if (!shell) {
      return;
    }

    const rect = shell.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }

    const relative = ((clientX - rect.left) / rect.width) * 100;
    const clamped = Math.max(20, Math.min(80, relative));
    setSplitRatio(clamped);
  }, []);

  const startSplitResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();

    const onPointerMove = (moveEvent: PointerEvent) => {
      applySplitRatioFromPointer(moveEvent.clientX);
    };

    const stopPointerTracking = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopPointerTracking);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopPointerTracking);
  }, [applySplitRatioFromPointer]);

  // Drag the rail's right edge to widen it; double-click the handle to reset.
  const startNavResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();

    const onPointerMove = (moveEvent: PointerEvent) => {
      const left = navRef.current?.getBoundingClientRect().left;
      if (left === undefined) {
        return;
      }
      setNavWidth(clampNavWidth(moveEvent.clientX - left));
    };

    const stopPointerTracking = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopPointerTracking);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopPointerTracking);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(NAV_WIDTH_KEY, String(navWidth));
    } catch {
      // Storage may be unavailable — the width simply resets next session.
    }
  }, [navWidth]);

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
      {
        id: "rename",
        label: "Rename page",
        disabled: isEditing,
        onClick: () => renamePageRef.current(activePage.path),
      },
      {
        id: "history",
        label: "History",
        disabled: isEditing,
        onClick: () => setHistoryOpen(true),
      },
      {
        id: "follow",
        label: followSubscriptionId ? "Unfollow page" : "Follow page",
        disabled: isEditing || followBusy || followSubscriptionId === undefined,
        onClick: () => void toggleFollow(),
      },
      {
        id: "attachments",
        label: "Attachments…",
        disabled: isEditing,
        onClick: () => setAttachmentsOpen(true),
      },
      {
        id: "export",
        label: "Export…",
        disabled: isEditing,
        onClick: () => setExportOpen(true),
      },
    ]);

    return () => {
      onHeaderMenuActionsChange?.([]);
    };
  }, [activePage, cancelEditing, followBusy, followSubscriptionId, isEditing, onHeaderMenuActionsChange, startEditing, toggleFollow]);

  // Loads a page by path, trying hyphen/space variants, and (optionally) syncs
  // the URL hash. This is the single entry point for all navigation:
  // tree clicks, in-page links, deep links, and browser back/forward.
  const loadPageByPath = useCallback(
    async (rawPath: string, updateHash: boolean, anchor?: string): Promise<boolean> => {
      if (!wikiClient || !activeWikiId) {
        return false;
      }

      setLoadState("loading");
      setError(undefined);

      for (const candidate of pagePathCandidates(rawPath)) {
        try {
          const page = await wikiClient.getPage(activeWikiId, candidate);
          setActivePage(page);
          // Scroll to the anchor if one was requested, otherwise clear any stale
          // anchor from a previous page.
          setActiveAnchor(anchor);
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

  const handleConfirmLinkUpdates = useCallback(async () => {
    const plan = linkUpdatePlan;
    if (!plan || !wikiClient || !activeWikiId) {
      return;
    }
    setLinkUpdateBusy(true);
    const failures: string[] = [];
    try {
      for (const update of plan.updates) {
        try {
          const page = await wikiClient.getPage(activeWikiId, update.path);
          const rewritten = rewriteWikiLinks(page.content, plan.oldPath, plan.newPath);
          if (rewritten.count > 0) {
            await wikiClient.savePage(activeWikiId, { ...page, content: rewritten.content });
          }
        } catch {
          failures.push(update.path);
        }
      }
      invalidateContentIndex();
      // Refresh the active page if its content was just rewritten.
      if (activePage && plan.updates.some((update) => update.path === activePage.path)) {
        await loadPageByPath(activePage.path, false);
      }
      if (failures.length > 0) {
        window.alert(`Could not update links on: ${failures.join(", ")}`);
      }
    } finally {
      setLinkUpdateBusy(false);
      setLinkUpdatePlan(undefined);
    }
  }, [activePage, activeWikiId, invalidateContentIndex, linkUpdatePlan, loadPageByPath, wikiClient]);

  // Absolute, shareable Azure DevOps deep link to a heading on the current page.
  const buildHeadingUrl = useCallback(
    (slug: string): string | undefined => {
      if (!activePage) {
        return undefined;
      }

      return buildHubPageUrl(
        { organizationName, projectName, organizationIsHosted, contributionId },
        buildNavigationHash(activeWiki, activePage.path, wikis),
        slug
      );
    },
    [activePage, activeWiki, contributionId, organizationIsHosted, organizationName, projectName, wikis]
  );

  // Clicking a heading permalink scrolls to it and reflects the anchor in the
  // route, so the URL stays shareable and back/forward restores the position.
  const handleHeadingLinkActivated = useCallback(
    (slug: string): void => {
      if (!activePage) {
        return;
      }

      setActiveAnchor(slug);
      setNavigationHash(
        navigationServiceRef.current,
        withHashAnchor(buildNavigationHash(activeWiki, activePage.path, wikis), slug)
      );
    },
    [activePage, activeWiki, wikis]
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

    // Ignore echoes of our own setHash() call — but still honor a new anchor on
    // the same page (e.g. the user pasted a deep link to another heading).
    if (parsed.pagePath === lastNavigatedPathRef.current) {
      if (parsed.anchor) {
        setActiveAnchor(parsed.anchor);
      }
      return;
    }

    void loadPageByPath(parsed.pagePath, false, parsed.anchor);
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

  // Reflect the active page's name in the host browser tab. The extension runs
  // in a cross-origin iframe, so setting document.title here has no effect on
  // the tab — the host navigation service is the only way to update it.
  useEffect(() => {
    if (!navigationReady || !activePage) {
      return;
    }
    try {
      navigationServiceRef.current?.setDocumentTitle(pageTitleFromPath(activePage.path));
    } catch {
      // Non-fatal: leave the host-managed title unchanged.
    }
  }, [navigationReady, activePage]);

  // The content area scrolls and persists across navigation (it lives outside
  // the per-page ErrorBoundary), so reset it to the top when moving to a
  // different page. Keyed on the path, so saving the same page keeps the scroll;
  // a deep-link anchor scroll runs afterward and takes precedence.
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [activePage?.path]);

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
        const savedInThisWiki = navigationTargetsWiki(saved, wikiId, wikis);
        const savedPath = savedInThisWiki ? saved?.pagePath : undefined;
        const savedAnchor = savedInThisWiki ? saved?.anchor : undefined;
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
        setActiveAnchor(initialPage ? savedAnchor : undefined);
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

  useEffect(() => {
    if (!activePage || isEditing) {
      onPageBylineChange?.(undefined);
      return;
    }

    onPageBylineChange?.({
      change: pageChange,
      changeLoading: pageChangeLoading,
      commentCount: commentsLoading ? undefined : comments.length,
      commentsOpen,
      onToggleComments: () => setCommentsOpen((open) => !open),
    });

    return () => {
      onPageBylineChange?.(undefined);
    };
  }, [activePage, comments.length, commentsLoading, commentsOpen, isEditing, onPageBylineChange, pageChange, pageChangeLoading]);

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

  // Loads the page's Git identity (id + path), its last-change byline, and its
  // comments whenever the active page changes.
  useEffect(() => {
    setPageMeta(undefined);
    setPageChange(undefined);
    setPageChangeLoading(Boolean(wikiClient && activeWikiId && activePage));
    setComments([]);
    setCommentsError(undefined);

    if (!wikiClient || !activeWikiId || !activePage) {
      setCommentsLoading(false);
      return;
    }

    let cancelled = false;
    const client = wikiClient;
    const wikiId = activeWikiId;
    const path = activePage.path;
    const repositoryId = activeWiki?.repositoryId;
    const branch = activeWiki?.version;
    setCommentsLoading(true);

    async function loadPageDetails() {
      let meta: WikiPageMeta | undefined;
      try {
        meta = await client.getPageMeta(wikiId, path);
      } catch {
        meta = undefined;
      }
      if (cancelled) {
        return;
      }
      setPageMeta(meta);

      if (meta?.gitItemPath && repositoryId) {
        void client
          .getPageLastChange(repositoryId, meta.gitItemPath, branch)
          .then((change) => {
            if (!cancelled) {
              setPageChange(change);
            }
          })
          .catch(() => {})
          .finally(() => {
            if (!cancelled) {
              setPageChangeLoading(false);
            }
          });
      } else {
        setPageChangeLoading(false);
      }

      if (!meta?.id) {
        setCommentsLoading(false);
        return;
      }

      try {
        const list = await client.listComments(wikiId, meta.id);
        if (!cancelled) {
          setComments(list);
        }
      } catch (commentsFailure: unknown) {
        if (!cancelled) {
          setCommentsError(formatError(commentsFailure));
        }
      } finally {
        if (!cancelled) {
          setCommentsLoading(false);
        }
      }
    }

    void loadPageDetails();
    return () => { cancelled = true; };
  }, [activePage, activeWikiId, activeWiki?.repositoryId, activeWiki?.version, wikiClient]);

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

  // Search covers every wiki in the project, so a hit can live in a wiki other
  // than the one being browsed. Switching wikis and letting the page-load effect
  // open the page is the route a deep link already takes, so results behave the
  // same way as a pasted URL.
  const handleSearchResultSelected = useCallback(
    (path: string, wikiName?: string) => {
      if (!confirmDiscardEdits()) {
        return;
      }

      // Results occupy the content area, so the query has to clear or the page
      // you just chose never becomes visible.
      onSearchQueryChange?.("");

      const targetWikiId = wikiName ? wikis.find((wiki) => wiki.name === wikiName)?.id : undefined;
      if (targetWikiId && targetWikiId !== activeWikiId) {
        savedNavigation.current = { pagePath: path, wikiId: targetWikiId, wikiName };
        setActiveWikiId(targetWikiId);
        return;
      }

      void loadPageByPath(path, true);
    },
    [activeWikiId, confirmDiscardEdits, loadPageByPath, wikis]
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

        // Offer to fix inbound links now pointing at the old path (#21 parity).
        void scanInboundLinks(sourcePath, newPath);
      } catch (moveError: unknown) {
        window.alert(`Could not move page: ${formatError(moveError)}`);
      }
    },
    [activePage, activeWikiId, loadPageByPath, reloadChildrenInto, scanInboundLinks, wikiClient]
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

  // Renaming a page is a same-parent move that changes only its last path
  // segment; performMove keeps the caches, active page, and inbound links in
  // sync just like a drag move does.
  const handleRenamePage = useCallback(
    async (path: string) => {
      if (!confirmDiscardEdits()) {
        return;
      }

      const currentName = path.split("/").filter(Boolean).at(-1) ?? path;
      const nextName = window.prompt("Rename page", currentName)?.trim();
      if (!nextName || nextName === currentName) {
        return;
      }

      if (nextName.includes("/")) {
        window.alert('A page name cannot contain "/".');
        return;
      }

      const parent = parentOfPath(path);
      const newPath = parent === "/" ? `/${nextName}` : `${parent}/${nextName}`;
      // Keep the page in its current slot; fall back to the end of the parent if
      // its order isn't known yet.
      const order =
        pageList.find((page) => page.path === path)?.order ??
        pageList.filter((page) => parentOfPath(page.path) === parent).length;
      await performMove(path, newPath, order);
    },
    [confirmDiscardEdits, pageList, performMove]
  );
  // The header menu is built (via effect) before this handler is defined, so it
  // dispatches through a ref that always points at the current handler.
  renamePageRef.current = handleRenamePage;

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
      onRenamePage: (path) => void handleRenamePage(path),
      getPageUrl: (path) =>
        buildHubPageUrl(
          { organizationName, projectName, organizationIsHosted, contributionId },
          buildNavigationHash(activeWiki, path, wikis)
        ),
    }),
    [activeWiki, contributionId, handleCreatePage, handleDeletePage, handleEditPage, handleNodeExpand, handleOpenMoveDialog, handlePageSelected, handleRenamePage, organizationIsHosted, organizationName, performMove, projectName, wikis]
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
      clearDraft(activeWikiId, activePage.path);
      setRecoverableDraft(undefined);
      invalidateContentIndex();
      setActivePage(savedPage);
      setDraftContent(savedPage.content);
      setIsEditing(false);
      setSaveState("idle");
    } catch (saveFailure: unknown) {
      setSaveState("failed");
      setSaveError(formatError(saveFailure));
    }
  }

  const handleAddComment = useCallback(
    async (text: string) => {
      if (!wikiClient || !activeWikiId || !pageMeta?.id) {
        return;
      }

      setCommentSubmitting(true);
      try {
        const created = await wikiClient.addComment(activeWikiId, pageMeta.id, text);
        setComments((prev) => [...prev, created]);
        setCommentsError(undefined);
      } catch (commentFailure: unknown) {
        setCommentsError(formatError(commentFailure));
      } finally {
        setCommentSubmitting(false);
      }
    },
    [activeWikiId, pageMeta?.id, wikiClient]
  );

  const uploadAttachment = useCallback(
    async (file: File) => {
      if (!wikiClient || !activeWikiId) {
        throw new Error("PowerWiki needs an Azure DevOps project context to upload files.");
      }

      const base64 = await fileToBase64(file);
      const attachment = await wikiClient.createAttachment(activeWikiId, buildAttachmentName(file), base64);
      return { name: attachment.name, path: attachment.path, isImage: isImageFile(file) };
    },
    [activeWikiId, wikiClient]
  );
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
  /**
   * Repoints every reference to a diagram at its new revision.
   *
   * This is what keeps one diagram shared by several pages in sync. It is not
   * optional bookkeeping: the wiki attachments API is create-only (a second PUT
   * to the same name is rejected, and there is no update or delete endpoint), so
   * a saved edit lands under a new filename and the old references would
   * otherwise keep showing the old picture.
   *
   * The page open in the editor is rewritten in the draft buffer rather than on
   * the server — saving it here would be clobbered by the user's own save.
   */
  const replaceDiagramReferences = useCallback(
    async (oldPath: string, newPath: string): Promise<readonly string[]> => {
      if (!wikiClient || !activeWikiId) {
        return [];
      }

      const updated: string[] = [];
      const editingPath = isEditing ? activePage?.path : undefined;
      if (editingPath) {
        const rewritten = rewriteWikiLinks(draftContent, oldPath, newPath);
        if (rewritten.count > 0) {
          setDraftContent(rewritten.content);
          updated.push(editingPath);
        }
      }

      const rewritePage = async (path: string): Promise<void> => {
        const page = await wikiClient.getPage(activeWikiId, path);
        const rewritten = rewriteWikiLinks(page.content, oldPath, newPath);
        if (rewritten.count > 0) {
          await wikiClient.savePage(activeWikiId, { ...page, content: rewritten.content });
          updated.push(path);
        }
      };

      const failures: string[] = [];

      // The active page is handled explicitly rather than through the index, so
      // the common case (a diagram on the page you are looking at) updates even
      // if the index is cold or slightly stale.
      if (activePage && !editingPath) {
        try {
          await rewritePage(activePage.path);
        } catch {
          failures.push(activePage.path);
        }
      }

      // Other pages come from the wiki-wide content index (also used by the
      // rename link scan). Each candidate is re-read before rewriting so a stale
      // index never overwrites newer content.
      for (const indexed of await ensureContentIndex()) {
        if (
          indexed.path === editingPath ||
          indexed.path === activePage?.path ||
          countDiagramReferences(indexed.content, oldPath) === 0
        ) {
          continue;
        }
        try {
          await rewritePage(indexed.path);
        } catch {
          failures.push(indexed.path);
        }
      }

      invalidateContentIndex();
      if (activePage && !editingPath && updated.includes(activePage.path)) {
        await loadPageByPath(activePage.path, false);
      }
      if (failures.length > 0) {
        throw new Error(`The diagram was saved, but these pages could not be updated: ${failures.join(", ")}`);
      }
      return updated;
    },
    [
      activePage,
      activeWikiId,
      draftContent,
      ensureContentIndex,
      invalidateContentIndex,
      isEditing,
      loadPageByPath,
      wikiClient,
    ]
  );

  /** Opens the draw.io editor on an existing diagram, loading its current bytes first. */
  const handleEditDiagram = useCallback(
    (src: string) => {
      const resolved = resolveImageSrc(src, activePage?.path ?? "/");
      if (!resolved) {
        setDiagramStatus("That diagram could not be located in this wiki.");
        return;
      }

      setDiagramError(undefined);
      setDiagramStatus("Opening diagram…");
      fetchAttachmentDataUrl(resolved)
        .then((dataUrl) => {
          setDiagramStatus(undefined);
          // Opened only once the bytes are in hand: the editor loads its content
          // when it starts, so it must not open on an empty canvas first.
          setDiagramTarget({ path: src, dataUrl });
        })
        .catch((loadFailure: unknown) => {
          setDiagramStatus(undefined);
          setError(formatError(loadFailure));
        });
    },
    [activePage?.path, resolveImageSrc]
  );

  /**
   * Opens the editor for a brand new diagram and resolves with the stored
   * attachment once it is saved (or undefined if the user closes without
   * saving), so the Markdown editor can insert the reference at the cursor.
   */
  const handleCreateDiagram = useCallback((): Promise<AttachmentUploadResult | undefined> => {
    setDiagramError(undefined);
    setDiagramStatus(undefined);
    setDiagramTarget({});
    return new Promise<AttachmentUploadResult | undefined>((resolve) => {
      pendingDiagramRef.current = resolve;
    });
  }, []);

  const closeDiagramEditor = useCallback(() => {
    pendingDiagramRef.current?.(undefined);
    pendingDiagramRef.current = undefined;
    setDiagramTarget(undefined);
    setDiagramError(undefined);
  }, []);

  const handleSaveDiagram = useCallback(
    async (pngDataUrl: string, title: string) => {
      if (!wikiClient || !activeWikiId) {
        setDiagramError("PowerWiki needs an Azure DevOps project context to save diagrams.");
        return;
      }

      const oldPath = diagramTarget?.path;

      // Saving without having changed anything must not leave a duplicate file
      // behind. The attachments API is create-only, so an unnecessary upload can
      // never be undone — and re-exporting an untouched diagram reproduces the
      // stored bytes exactly, which makes the no-op case reliably detectable.
      const loaded = diagramTarget?.dataUrl;
      if (oldPath && loaded && dataUrlToBase64(loaded) === dataUrlToBase64(pngDataUrl)) {
        setDiagramTarget(undefined);
        setDiagramStatus("No changes to save.");
        return;
      }

      setDiagramBusy(true);
      setDiagramError(undefined);
      try {
        // Every save writes a new revision; the attachments API cannot overwrite.
        const name = oldPath ? nextDiagramName(oldPath) : newDiagramName(title);
        const attachment = await wikiClient.createAttachment(
          activeWikiId,
          name,
          dataUrlToBase64(pngDataUrl)
        );

        if (oldPath) {
          const updated = await replaceDiagramReferences(oldPath, attachment.path);
          setDiagramStatus(
            updated.length > 1
              ? `Diagram updated on ${updated.length} pages.`
              : "Diagram updated."
          );
        } else {
          pendingDiagramRef.current?.({ name: attachment.name, path: attachment.path, isImage: true });
          pendingDiagramRef.current = undefined;
          setDiagramStatus("Diagram inserted.");
        }
        setDiagramTarget(undefined);
      } catch (saveFailure: unknown) {
        setDiagramError(formatError(saveFailure));
      } finally {
        setDiagramBusy(false);
      }
    },
    [activeWikiId, diagramTarget?.path, replaceDiagramReferences, wikiClient]
  );

  // Diagram status is a transient confirmation, so it clears itself.
  useEffect(() => {
    if (!diagramStatus) {
      return;
    }
    const timer = window.setTimeout(() => setDiagramStatus(undefined), 4000);
    return () => window.clearTimeout(timer);
  }, [diagramStatus]);

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
  const loadMention = useCallback(
    (id: string) => identityClient.getMentionIdentity(id),
    [identityClient]
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
        ref={navRef}
        style={navCollapsed ? undefined : { width: `${navWidth}px` }}
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
            <div className="powerwiki-nav-search">
              <input
                aria-label="Filter pages by name"
                className="powerwiki-nav-search-input"
                disabled={!activeWikiId}
                onChange={(event) => setTreeFilter(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setTreeFilter("");
                  }
                }}
                placeholder="Filter pages…"
                type="search"
                value={treeFilter}
              />
              {treeFilter ? (
                <button
                  aria-label="Clear filter"
                  className="powerwiki-nav-search-clear"
                  onClick={() => setTreeFilter("")}
                  type="button"
                >
                  ×
                </button>
              ) : null}
            </div>
            <div className="powerwiki-nav-tree">
              {/* When a filter matches nothing, show only that. Rendering the
                  tree as well produces its "no pages in this wiki" empty state
                  beside it, which is both a duplicate and untrue. */}
              {treeFilter.trim() && filteredPageTree.length === 0 ? (
                <p className="powerwiki-nav-filter-empty">No page name matches “{treeFilter.trim()}”.</p>
              ) : (
                <WikiPageTree
                  actions={treeActions}
                  activePath={activePage?.path}
                  isLoading={loadState === "loading" && pageTree.length === 0}
                  nodes={filteredPageTree}
                />
              )}
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
            <div
              aria-label="Resize the page tree"
              aria-orientation="vertical"
              className="powerwiki-nav-resizer"
              onDoubleClick={() => setNavWidth(NAV_WIDTH_DEFAULT)}
              onPointerDown={startNavResize}
              role="separator"
              title="Drag to resize (double-click to reset)"
            />
          </>
        )}
      </aside>

      {/* While editing the content area stops scrolling and becomes a flex
          column, so the editor (and the split preview beside it) fill the whole
          height the hub gives us instead of a fixed viewport fraction. */}
      <article
        className={activePage && isEditing ? "powerwiki-content editing" : "powerwiki-content"}
        ref={contentRef}
      >
        <ErrorBoundary key={activePage?.path ?? "no-page"} label="page">
        {/* A full-text query takes over the content area rather than the rail:
            snippets need the width, and the tree stays visible so the reader
            keeps their place in the wiki while scanning results. */}
        {searchQuery.trim() ? (
          <WikiSearchResults
            activeWikiName={activeWiki?.name}
            onSearchContent={searchContent}
            onSelect={handleSearchResultSelected}
            pages={pageLinks}
            query={searchQuery}
          />
        ) : activePage && isEditing ? (
          <section className="wiki-editor-shell" aria-label={`Editing ${pageTitle(activePage.path)}`}>
            <div className="wiki-editor-toolbar">
              <div>
                <strong>{pageTitle(activePage.path)}</strong>
                <span>{hasUnsavedChanges ? "Unsaved changes" : "No changes"}</span>
              </div>
              <div className="wiki-editor-toolbar-actions">
                <select
                  aria-label="Edit mode"
                  className="wiki-editor-mode-select"
                  disabled={saveState === "saving"}
                  onChange={(event) => setEditMode(event.target.value as EditMode)}
                  value={editMode}
                >
                  <option value="code">Code</option>
                  <option value="splitCode">Split Code</option>
                  <option value="richText">Rich Text</option>
                </select>
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
            {editMode === "richText" ? (
              <WikiRichTextEditor
                currentPath={activePage.path}
                disabled={saveState === "saving"}
                onChange={setDraftContent}
                onResolveImageSrc={resolveImageSrc}
                onLoadImage={fetchAttachmentObjectUrl}
                onUploadAttachment={uploadAttachment}
                value={draftContent}
              />
            ) : null}
            {editMode === "code" ? (
              <WikiPageEditor
                disabled={saveState === "saving"}
                onChange={setDraftContent}
                onCreateDiagram={handleCreateDiagram}
                onListAttachments={listWikiAttachments}
                onUploadAttachment={uploadAttachment}
                pages={pageLinks}
                value={draftContent}
              />
            ) : null}
            {editMode === "splitCode" ? (
              <div className="wiki-editor-split-shell" ref={splitShellRef}>
                <div className="wiki-editor-split-pane wiki-editor-split-pane-code" style={{ width: `${splitRatio}%` }}>
                  <WikiPageEditor
                    disabled={saveState === "saving"}
                    onChange={setDraftContent}
                    onCreateDiagram={handleCreateDiagram}
                    onListAttachments={listWikiAttachments}
                    onUploadAttachment={uploadAttachment}
                    pages={pageLinks}
                    value={draftContent}
                  />
                </div>
                <div
                  aria-label="Resize code and preview panes"
                  className="wiki-editor-split-resizer"
                  onPointerDown={startSplitResize}
                  role="separator"
                />
                <div className="wiki-editor-split-pane wiki-editor-split-pane-preview" style={{ width: `${100 - splitRatio}%` }}>
                  <MarkdownPreview
                    markdown={draftContent}
                    currentPath={activePage.path}
                    subPages={subPages}
                    anchor={activeAnchor}
                    buildHeadingUrl={buildHeadingUrl}
                    onHeadingLinkActivated={handleHeadingLinkActivated}
                    onLoadQueryTable={loadQueryTable}
                    onLoadWorkItemBadge={loadWorkItemBadge}
                    onLoadMention={loadMention}
                    onNavigate={(path) => {
                      if (confirmDiscardEdits()) {
                        void loadPageByPath(path, true);
                      }
                    }}
                    onOpenWorkItem={(id) => void openWorkItem(id)}
                    onResolveImageSrc={resolveImageSrc}
                    onLoadImage={fetchAttachmentObjectUrl}
                    onEditDiagram={handleEditDiagram}
                  />
                </div>
              </div>
            ) : null}
          </section>
        ) : activePage ? (
          <>
            {recoverableDraft ? (
              <div className="wiki-draft-recovery" role="alert">
                <span className="wiki-draft-recovery-text">
                  You have an unsaved draft of this page from {formatDraftTime(recoverableDraft.savedAt)}.
                </span>
                <span className="wiki-draft-recovery-actions">
                  <button className="wiki-draft-recovery-restore" onClick={restoreDraft} type="button">
                    Restore draft
                  </button>
                  <button onClick={discardDraft} type="button">
                    Discard
                  </button>
                </span>
              </div>
            ) : null}
            <MarkdownPreview
              markdown={activePage.content}
              currentPath={activePage.path}
              subPages={subPages}
              anchor={activeAnchor}
              buildHeadingUrl={buildHeadingUrl}
              onHeadingLinkActivated={handleHeadingLinkActivated}
              onLoadQueryTable={loadQueryTable}
              onLoadWorkItemBadge={loadWorkItemBadge}
              onLoadMention={loadMention}
              onNavigate={(path) => {
                if (confirmDiscardEdits()) {
                  void loadPageByPath(path, true);
                }
              }}
              onOpenWorkItem={(id) => void openWorkItem(id)}
              onResolveImageSrc={resolveImageSrc}
              onLoadImage={fetchAttachmentObjectUrl}
              onEditDiagram={handleEditDiagram}
            />
          </>
        ) : (
          <StatusMessage
            message={loadState === "loading" ? "Loading wiki content." : "Select a page to view it."}
            title={loadState === "loading" ? "Loading" : "No page selected"}
          />
        )}
        </ErrorBoundary>
      </article>

      {activePage && !isEditing && commentsOpen ? (
        <WikiCommentsPanel
          comments={comments}
          error={commentsError}
          loading={commentsLoading}
          onClose={() => setCommentsOpen(false)}
          onSubmit={handleAddComment}
          submitting={commentSubmitting}
        />
      ) : null}

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

      {attachmentsOpen ? (
        <WikiAttachmentsDialog
          loadAttachments={listWikiAttachments}
          onClose={() => setAttachmentsOpen(false)}
          resolveImageSrc={resolveImageSrc}
          onLoadImage={fetchAttachmentObjectUrl}
        />
      ) : null}

      {diagramTarget ? (
        <DrawioEditorDialog
          busy={diagramBusy}
          error={diagramError}
          onClose={closeDiagramEditor}
          onSave={(pngDataUrl, title) => void handleSaveDiagram(pngDataUrl, title)}
          target={diagramTarget}
        />
      ) : null}

      {diagramStatus ? (
        <div className="powerwiki-diagram-toast" role="status">
          {diagramStatus}
        </div>
      ) : null}

      {linkUpdatePlan ? (
        <WikiLinkUpdateDialog
          busy={linkUpdateBusy}
          newPath={linkUpdatePlan.newPath}
          oldPath={linkUpdatePlan.oldPath}
          onConfirm={() => void handleConfirmLinkUpdates()}
          onSkip={() => setLinkUpdatePlan(undefined)}
          updates={linkUpdatePlan.updates}
        />
      ) : null}

      {historyOpen && activePage ? (
        <WikiHistoryDialog
          currentContent={activePage.content}
          loadContentAt={loadRevisionContent}
          loadRevisions={loadPageRevisions}
          onClose={() => setHistoryOpen(false)}
          onRestore={handleRestoreRevision}
          pageTitle={pageTitleFromPath(activePage.path)}
        />
      ) : null}

      {exportOpen && activePage ? (
        <WikiExportDialog
          currentPage={{ path: activePage.path, title: pageTitleFromPath(activePage.path) }}
          loadImage={loadExportImage}
          loadPageContent={loadPageContent}
          onClose={() => setExportOpen(false)}
          onExpandNode={(path) => void handleNodeExpand(path)}
          renderOptions={{
            themeMode,
            resolveImageSrc,
            loadQueryTable,
            loadWorkItemBadge,
            loadMention,
          }}
          treeNodes={pageTree}
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
