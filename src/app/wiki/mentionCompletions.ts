// The "@" mention picker for the Monaco Markdown editor.
//
// A completion provider rather than a bespoke popup, for the same reason the
// slash palette is one: Monaco already owns filtering, keyboard navigation,
// positioning and accepting, and a hand-rolled popup beside it would be a second
// set of those behaviours to keep in step.
//
// The difference from the slash palette is that the items are not a constant —
// each keystroke would otherwise be a round trip across the iframe boundary to
// the host's identity service. Hence the cache and the minimum query length
// below; both exist to keep a fast typist from queueing a request per character.

import type * as Monaco from "monaco-editor";

import type { MentionIdentity } from "../../rendering/MarkdownPreview";
import { insideExistingMention, matchMentionTrigger, mentionMarkdown } from "./mentionTrigger";

type MonacoApi = typeof Monaco;

/** Searches people and teams by partial name. Supplied by the host. */
export type MentionSearch = (query: string) => Promise<readonly MentionIdentity[]>;

/**
 * One character, not two, and that is forced rather than chosen.
 *
 * Monaco ends a completion session as soon as a provider answers with an *empty*
 * list — `incomplete: true` does not save it. So a "too short to search yet"
 * guard that returns nothing kills the trigger: measured against a real
 * organisation, the provider fired for "@" and "@p" and was never asked again,
 * however the result was flagged. Searching from the first character keeps the
 * session alive, and the cache below stops that costing a request per keystroke.
 *
 * A bare "@" still searches for nothing and shows nothing, so an "@" typed in
 * ordinary prose costs no round trip.
 */
const MIN_QUERY_LENGTH = 1;

/**
 * How long a query's results stay usable. Short, because the point is to absorb
 * the burst of keystrokes in one word rather than to hold a directory in memory:
 * someone added to a team should show up on the next attempt, not in ten minutes.
 */
const CACHE_TTL_MS = 30_000;

// The provider is registered once for the Markdown language, but the search it
// runs belongs to whichever host is mounted — and there is none in a VS Code
// webview. Kept here and swapped by the editor, exactly as the slash palette
// does for its diagram command.
let searchHandler: MentionSearch | undefined;
const cache = new Map<string, { at: number; identities: readonly MentionIdentity[] }>();

/**
 * Sets (or clears) the identity search the "@" picker uses. Clearing it turns
 * the picker off, which is what a host with no identity service wants: no
 * suggestions at all beats a picker that opens and can never fill.
 */
export function setMentionSearchHandler(handler: MentionSearch | undefined): void {
  searchHandler = handler;
  cache.clear();
}

/** Test seam: drops memoised results so a case cannot see a previous one's. */
export function clearMentionCache(): void {
  cache.clear();
}

/**
 * Runs the search, reusing a recent identical query.
 *
 * `now` is injected rather than read from the clock so expiry is testable
 * without waiting.
 */
export async function searchMentions(
  query: string,
  search: MentionSearch,
  now: number = Date.now()
): Promise<readonly MentionIdentity[]> {
  const key = query.trim().toLowerCase();
  if (key.length < MIN_QUERY_LENGTH) {
    return [];
  }

  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return hit.identities;
  }

  // A failed search is not cached: the identity service being briefly
  // unreachable should not blank the picker for the next half minute.
  const identities = await search(query);
  cache.set(key, { at: now, identities });
  return identities;
}

let registered = false;

/** Registers the "@" completion provider once for the Markdown language. */
export function registerMentionCompletions(monaco: MonacoApi): void {
  if (registered) {
    return;
  }
  registered = true;

  monaco.languages.registerCompletionItemProvider("markdown", {
    triggerCharacters: ["@"],
    async provideCompletionItems(model, position, _context, token) {
      const search = searchHandler;
      if (!search) {
        return { suggestions: [] };
      }

      const lineUpToCaret = model.getValueInRange({
        startColumn: 1,
        startLineNumber: position.lineNumber,
        endColumn: position.column,
        endLineNumber: position.lineNumber,
      });

      if (insideExistingMention(lineUpToCaret)) {
        return { suggestions: [] };
      }

      const trigger = matchMentionTrigger(lineUpToCaret);
      if (!trigger) {
        return { suggestions: [] };
      }

      // Below the minimum the list is empty, but the trigger is live: mark it
      // incomplete so Monaco comes back on the next keystroke (see INCOMPLETE).
      if (trigger.query.trim().length < MIN_QUERY_LENGTH) {
        return { suggestions: [], incomplete: true };
      }

      let identities: readonly MentionIdentity[];
      try {
        identities = await searchMentions(trigger.query, search);
      } catch {
        // The picker is an aid, not the only way to write a mention: the format
        // is plain text and can be typed. Failing silently beats an error
        // interrupting the sentence being written — and `incomplete` means the
        // next keystroke retries rather than inheriting the failure.
        return { suggestions: [], incomplete: true };
      }

      // The user has typed on since this search started, so its results are for
      // a query that is no longer on screen.
      if (token.isCancellationRequested) {
        return { suggestions: [], incomplete: true };
      }

      const range = new monaco.Range(
        position.lineNumber,
        trigger.atIndex + 1,
        position.lineNumber,
        position.column
      );

      return {
        // INCOMPLETE. Without this Monaco treats the first answer as the whole
        // answer: once the trigger character opens the widget it re-filters that
        // list locally instead of asking again, so typing on past "@p" never
        // reached the identity service and the widget kept showing whatever it
        // had. Measured, not guessed — the provider was seen firing for "@" and
        // "@p" and never for "@pe".
        incomplete: true,
        // Monaco would otherwise re-filter these against the typed text using
        // its own fuzzy matching, dropping perfectly good matches the identity
        // service returned on a surname or an email.
        suggestions: identities.map((identity, index) => ({
          label: identity.displayName,
          detail: identity.uniqueName,
          kind: monaco.languages.CompletionItemKind.User,
          insertText: mentionMarkdown(identity.id),
          filterText: lineUpToCaret.slice(trigger.atIndex),
          sortText: String(index).padStart(3, "0"),
          range,
        })),
      };
    },
  });
}
