// The message protocol between the PowerWiki webview and the extension host.
//
// Imported by both sides, and by nothing else, so the two cannot drift. It is
// deliberately thin: the webview asks for a `WikiRepositoryClient` method by
// name and gets its result back, because that interface is already entirely
// asynchronous — there is no state to mirror and no second model to keep in
// step. Anything that is *not* a wiki read/write (dialogs, opening a page,
// telling VS Code what is on screen) gets its own message rather than being
// squeezed into the same channel.

import type { WikiHostCapabilities, WikiHostContext } from "../host/WikiHost";
import type { WikiSearchOutcome } from "../wiki/wikiSearch";
import type { WikiSummary } from "../wiki/WikiPage";

/** Methods the webview may invoke on the extension host. */
export type HostMethod =
  | "wiki"
  | "search"
  | "confirm"
  | "prompt"
  | "alert"
  | "openPage"
  | "openExternal";

export interface RpcRequest {
  readonly type: "request";
  readonly id: number;
  readonly method: HostMethod;
  /**
   * For `wiki`, the first element is the `WikiRepositoryClient` method name and
   * the rest are its arguments.
   */
  readonly args: readonly unknown[];
}

export interface RpcResponse {
  readonly type: "response";
  readonly id: number;
  readonly value?: unknown;
  readonly error?: string;
}

/** Everything the webview needs before it can render. */
export interface InitMessage {
  readonly type: "init";
  readonly context: WikiHostContext;
  readonly capabilities: WikiHostCapabilities;
  readonly wikis: readonly WikiSummary[];
  /** Wiki and page this editor tab is showing. */
  readonly activeWikiId: string;
  readonly activePagePath: string;
  /** Webview URI of the PowerWiki logo (relative paths do not resolve here). */
  readonly logoUrl: string;
  /**
   * Base URI for files under the wiki root, with a trailing slash. Attachment
   * images are ordinary local files, so they are addressed directly rather than
   * fetched and turned into blobs the way the hub has to.
   */
  readonly attachmentBaseUrl: string;
  /** Webview URI of Monaco's AMD build; nothing relative resolves in a webview. */
  readonly monacoBaseUrl: string;
}

/** The extension telling the webview which page to show. */
export interface NavigateMessage {
  readonly type: "navigate";
  readonly pagePath: string;
}

/** The file behind the current page changed outside PowerWiki. */
export interface ReloadMessage {
  readonly type: "reload";
}

export type ExtensionMessage = InitMessage | NavigateMessage | ReloadMessage | RpcResponse;

/**
 * What the webview is currently showing.
 *
 * Two jobs: it tells the extension whether an edit is in progress (so an
 * external file change does not reload the page out from under someone who is
 * typing), and it is the observation point the UI tests assert on — the
 * alternative would be reaching into webview DOM from the extension host, which
 * is not possible.
 */
export interface StateMessage {
  readonly type: "state";
  readonly pagePath?: string;
  readonly title?: string;
  readonly editing: boolean;
  /** Rendered heading texts, in document order. Empty while loading. */
  readonly headings: readonly string[];
  /** True once the page body has rendered at least once. */
  readonly rendered: boolean;
  readonly error?: string;
  /**
   * Which pieces of PowerWiki's own chrome are on screen.
   *
   * Reported because "the Explorer replaces our tree" and "there are no
   * comments here" are claims about what a user sees, and a capability flag
   * only says what was *intended*. These say what was rendered.
   */
  readonly chrome: {
    readonly pageTree: boolean;
    readonly wikiSelector: boolean;
    readonly commentsToggle: boolean;
    /** Work-item badges present but not enriched — i.e. inert, as intended. */
    readonly inertWorkItems: number;
    /** Mentions left unresolved, for the same reason. */
    readonly inertMentions: number;
  };
}

export type WebviewMessage = RpcRequest | StateMessage;

/**
 * Binary results cross the boundary as base64.
 *
 * `postMessage` to a webview serialises as JSON, so an ArrayBuffer would arrive
 * as `{}` — silently, and only for the one method that returns bytes. Marking
 * the method here keeps both sides honest about which that is.
 */
export const BINARY_WIKI_METHODS: ReadonlySet<string> = new Set(["getItemBytes"]);

export interface SearchRequest {
  readonly wikiId: string;
  readonly query: string;
}

export type SearchResponse = WikiSearchOutcome;
