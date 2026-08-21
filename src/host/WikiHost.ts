// The single host abstraction PowerWiki's UI runs against.
//
// PowerWiki has two hosts: the Azure DevOps hub (`src/host/azureDevOpsWikiHost.ts`)
// and the VS Code extension (`src/vscode/`). Everything above this interface —
// the browser shell, the editors, rendering, export, draw.io — is written once
// and knows nothing about either. That is deliberate: a second host is only
// affordable if features are built once, so the rule is that **nothing under
// `src/app/`, `src/rendering/`, or `src/export/` may import a host SDK**. If a
// feature needs something host-specific, it gets a member here and each host
// answers for itself.
//
// Capabilities, not feature flags: a host declares what it *can* do, and the UI
// hides what is unavailable rather than showing an action that fails. A local
// clone has no comment service and no identity service, so it says so.

import type {
  MentionIdentity,
  QueryTableResult,
  WorkItemBadgeDetails
} from "../rendering/MarkdownPreview";
import type { WikiSummary } from "../wiki/WikiPage";
import type { WikiRepositoryClient } from "../wiki/WikiRepositoryClient";
import type { WikiSearchOutcome } from "../wiki/wikiSearch";
import type { LinkedWorkItemsResult } from "../workItems/LinkedWorkItem";

/** Who and where we are. Both hosts fill in what they can; all of it is optional bar the name. */
export interface WikiHostContext {
  readonly organizationName?: string;
  readonly organizationIsHosted?: boolean;
  readonly projectName?: string;
  /** Project GUID, used for artifact subscriptions (follow). */
  readonly projectId?: string;
  readonly userDisplayName: string;
  /** Current user's identity id, used for artifact subscriptions (follow). */
  readonly userId?: string;
  /** Full contribution id of the current hub, used to build shareable links. */
  readonly contributionId?: string;
}

/**
 * What this host supports. The UI reads these instead of sniffing for an SDK,
 * so an unavailable feature is absent rather than broken.
 */
export interface WikiHostCapabilities {
  /** Page comments. Azure DevOps only — comments are service state, not files. */
  readonly comments: boolean;
  /** Follow/notification subscriptions. Azure DevOps only. */
  readonly follow: boolean;
  /** Work-item badge enrichment and Boards query tables. */
  readonly workItems: boolean;
  /** `@mention` resolution to a display name. */
  readonly mentions: boolean;
  /** PowerWiki's own page-tree rail. VS Code turns this off: the Explorer is the tree. */
  readonly pageTree: boolean;
  /**
   * The rail lists the wiki pages linked to a work item rather than the page
   * tree. Only the work item form does this: there the wiki is being read in the
   * context of one work item, which makes its links the useful navigation and
   * the whole tree the wrong one. Mutually exclusive with `pageTree`.
   */
  readonly linkedPages: boolean;
  /**
   * The page can show which work items link to it. Read-only, and the mirror
   * image of `linkedPages`: that lists a work item's pages, this lists a page's
   * work items. On in the hub, where the wiki is what you are looking at; off on
   * the work item form, where the work item is already on screen.
   */
  readonly linkedWorkItems: boolean;
  /** The wiki picker. Off where the host already chose the wiki (a VS Code editor tab). */
  readonly wikiSelector: boolean;
  /**
   * Whether a search box belongs on this surface at all. Distinct from
   * `searchContent`, which says whether *full-text* search is reachable: a host
   * that offers the box but no content search still matches page titles from
   * the pages it has in memory. Off on the work item form, which exists to show
   * one item's linked pages rather than to browse the wiki.
   */
  readonly search: boolean;
  /** Shareable absolute deep links to a page/heading. */
  readonly permalinks: boolean;
  /**
   * Offers to hand the wiki over to VS Code — clone the repository, install the
   * VS Code extension. Only meaningful from the Azure DevOps hub; inside VS Code
   * the user is already there.
   */
  readonly vsCodeHandoff: boolean;
  /**
   * PDF export, which works by rendering the pages into the document and
   * calling `window.print()`. A VS Code webview provides no print pipeline, so
   * the option is withheld there rather than offered and doing nothing.
   */
  readonly printToPdf: boolean;
}

/**
 * Route access, owned by the host because neither host lets the app touch the
 * address bar: the hub runs in a cross-origin iframe, and VS Code has no URL at
 * all — there the "hash" is whichever document the editor tab is showing.
 */
export interface WikiHostNavigation {
  getHash(): Promise<string>;
  setHash(hash: string): Promise<void>;
  onHashChanged(callback: (hash: string) => void): void;
  setDocumentTitle(title: string): void;
}

export interface WikiPageFollowTarget {
  readonly projectId: string;
  readonly wikiId: string;
  readonly pageId: number;
  readonly userId: string;
}

export interface FollowProvider {
  getFollowSubscription(target: WikiPageFollowTarget): Promise<string | undefined>;
  follow(target: WikiPageFollowTarget): Promise<string>;
  unfollow(subscriptionId: string): Promise<void>;
}

/** A wiki page linked to a work item. */
export interface LinkedWikiPage {
  readonly projectId: string;
  readonly wikiId: string;
  /** Wiki-relative page path, e.g. "/PowerWiki Showcase/Mermaid Gallery". */
  readonly path: string;
  /** The link's own comment, if the person who made it left one. */
  readonly comment?: string;
}

/**
 * The wiki pages linked to the work item currently on screen.
 *
 * Present only on the work item form surface. Adding and removing go through
 * the host's form service rather than the REST API, so neither needs a write
 * scope: the change is made to the open form and the user saves the work item
 * as usual.
 */
export interface LinkedPagesProvider {
  list(): Promise<readonly LinkedWikiPage[]>;
  /**
   * Links a page to the open work item. Leaves the form dirty rather than
   * saving, so linking is undone by discarding the work item like any other
   * unsaved change.
   */
  add(page: { readonly wikiId: string; readonly path: string }): Promise<void>;
  /**
   * Unlinks a page from the open work item. Same bargain as `add`: the form is
   * left dirty, so the removal is committed by saving and abandoned by
   * discarding. Callers confirm first — this is destructive from the reader's
   * point of view even though the page itself is untouched.
   */
  remove(page: { readonly path: string }): Promise<void>;
}

export interface WorkItemProvider {
  getWorkItemBadgeDetails(id: number): Promise<WorkItemBadgeDetails>;
  getQueryTable(queryId: string): Promise<QueryTableResult>;
  /**
   * The work items linking to a wiki page.
   *
   * Takes the page rather than an artifact URI: the `vstfs:///Wiki/WikiPage/...`
   * format is Azure DevOps' own, and building it here would put a host's storage
   * format above the interface. The host that understands it composes it.
   *
   * A read, so it costs no scope beyond the work item read access the badges
   * already need. Writing a link is not offered for the opposite reason — the
   * relation lives on the work item, so creating one needs `vso.work_write`.
   */
  getLinkedWorkItems(page: {
    readonly wikiId: string;
    readonly path: string;
  }): Promise<LinkedWorkItemsResult>;

  /** Opens the work item in whatever UI the host has (a form, a browser tab). */
  openWorkItem(id: number): Promise<void>;
}

/**
 * Simple modal prompts, owned by the host because `window.alert`/`confirm`/
 * `prompt` are not universally available: a VS Code webview iframe is sandboxed
 * without `allow-modals`, so `confirm()` silently returns false and `prompt()`
 * returns null there. Using them directly would leave "create page", "rename"
 * and every discard guard quietly broken rather than visibly unsupported.
 *
 * All three are async so a host can answer with a real UI of its own.
 */
export interface WikiHostDialogs {
  alert(message: string): Promise<void>;
  confirm(message: string): Promise<boolean>;
  prompt(message: string, defaultValue?: string): Promise<string | undefined>;
}

export interface IdentityProvider {
  getMentionIdentity(id: string): Promise<MentionIdentity>;
}

export interface WikiHost {
  readonly context: WikiHostContext;
  readonly capabilities: WikiHostCapabilities;
  readonly wikiClient: WikiRepositoryClient;
  readonly dialogs: WikiHostDialogs;

  /**
   * Full-text search, or undefined when this host cannot search (no organization
   * context in the hub). The UI still matches page titles locally in that case,
   * so returning undefined degrades rather than failing.
   */
  readonly searchContent?: (searchText: string) => Promise<WikiSearchOutcome>;

  /** Absent where the capability is false. Callers must handle undefined. */
  readonly workItems?: WorkItemProvider;
  readonly identity?: IdentityProvider;
  readonly follow?: FollowProvider;
  readonly linkedPages?: LinkedPagesProvider;

  /** Resolves once the host's route service is ready, or undefined if it has none. */
  getNavigation(): Promise<WikiHostNavigation | undefined>;

  /**
   * Turns a resolved attachment URL into something an `<img>` can display.
   * In the hub that means fetching the bytes with an access token (a bare
   * cross-origin `<img src>` is sent unauthenticated and redirected to sign-in);
   * in VS Code it means a webview URI for a file on disk.
   */
  loadImageObjectUrl(url: string): Promise<string>;

  /**
   * The same bytes as a base64 data URL. The draw.io editor needs this rather
   * than an object URL, because its iframe is a different origin and cannot
   * resolve a `blob:` URL minted here.
   */
  loadImageDataUrl(url: string): Promise<string>;

  /**
   * Delivers an exported file to the user.
   *
   * A browser does this with an `<a download>` click; a VS Code webview blocks
   * downloads entirely, so there it is a save dialog and a file write in the
   * extension host. Same reason as `dialogs`: it looks like something the page
   * can just do, and in one of the two hosts it silently is not.
   */
  saveExportedFile(fileName: string, blob: Blob): Promise<void>;

  /** Opens a URL outside the app: a new browser tab, or the OS handler. */
  openExternal(url: string): void;

  /** Absolute shareable URL for a route hash, or undefined when unsupported. */
  buildPageUrl(pageHash: string, anchor?: string): string | undefined;

  /**
   * A URL this host can serve a file in the wiki's repository from, given the
   * wiki-relative path exactly as the Markdown wrote it. The hub returns an
   * authenticated Items API URL; VS Code returns a webview URI for the file on
   * disk. `loadImageObjectUrl` is what finally turns it into something an
   * `<img>` can show.
   */
  buildAttachmentUrl(wiki: WikiSummary, wikiPath: string): string | undefined;
}
