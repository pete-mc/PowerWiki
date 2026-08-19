// Full-text search across a wiki on disk.
//
// The hub sends this to `almsearch.dev.azure.com`. There is no such service
// here, and there does not need to be: a wiki is a few hundred Markdown files,
// so scanning them is a local read rather than a request per page. What matters
// is that the *result* is a `WikiSearchOutcome`, because that is what
// `WikiSearchResults` already knows how to render — snippets included,
// highlighted as segments so nothing goes near innerHTML.

import type { WikiSearchHit, WikiSearchOutcome, WikiSearchSegment } from "../wiki/wikiSearch";
import { pageTitle } from "./wikiPathEncoding";

export interface SearchablePage {
  readonly path: string;
  readonly content: string;
}

export interface LocalSearchOptions {
  readonly wikiName?: string;
  readonly projectName?: string;
  /** Cap on hits returned. Reported through the `trimmed` status, not silently. */
  readonly maxResults?: number;
  /** Characters of context either side of a match. */
  readonly snippetRadius?: number;
  /** Snippets per page. */
  readonly maxSnippets?: number;
}

const DEFAULT_MAX_RESULTS = 50;
const DEFAULT_SNIPPET_RADIUS = 60;
const DEFAULT_MAX_SNIPPETS = 3;

/**
 * Pages matching every term in `query`, ranked title matches first.
 *
 * All terms must appear somewhere in the page (title or body), which is the
 * behaviour people expect from the hub's search box for multi-word queries.
 */
export function searchLocalWiki(
  pages: readonly SearchablePage[],
  query: string,
  options: LocalSearchOptions = {}
): WikiSearchOutcome {
  const terms = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
  if (terms.length === 0) {
    return { status: { kind: "ok", trimmed: false }, total: 0, hits: [] };
  }

  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const scored: { hit: WikiSearchHit; score: number }[] = [];

  for (const page of pages) {
    const title = pageTitle(page.path);
    const haystack = `${title}\n${page.content}`.toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) {
      continue;
    }

    const lowerTitle = title.toLowerCase();
    // A page whose *name* matches is nearly always the one being looked for, so
    // it outranks a page that merely mentions the words in passing.
    const score = terms.reduce((total, term) => total + (lowerTitle.includes(term) ? 2 : 0), 0);

    scored.push({
      score,
      hit: {
        path: page.path,
        fileName: title,
        wikiName: options.wikiName,
        projectName: options.projectName,
        snippets: buildSnippets(page.content, terms, options)
      }
    });
  }

  scored.sort((a, b) => b.score - a.score || a.hit.path.localeCompare(b.hit.path));

  return {
    // Reporting the cap rather than hiding it: `trimmed` is what tells the user
    // there is more than they can see.
    status: { kind: "ok", trimmed: scored.length > maxResults },
    total: scored.length,
    hits: scored.slice(0, maxResults).map((entry) => entry.hit)
  };
}

function buildSnippets(
  content: string,
  terms: readonly string[],
  options: LocalSearchOptions
): readonly (readonly WikiSearchSegment[])[] {
  const radius = options.snippetRadius ?? DEFAULT_SNIPPET_RADIUS;
  const maxSnippets = options.maxSnippets ?? DEFAULT_MAX_SNIPPETS;
  const lower = content.toLowerCase();

  const windows: { start: number; end: number }[] = [];
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index < 0) {
      continue;
    }

    const start = Math.max(0, index - radius);
    const end = Math.min(content.length, index + term.length + radius);
    const overlapping = windows.find((window) => start <= window.end && end >= window.start);
    if (overlapping) {
      overlapping.start = Math.min(overlapping.start, start);
      overlapping.end = Math.max(overlapping.end, end);
    } else {
      windows.push({ start, end });
    }
  }

  if (windows.length === 0) {
    // A page matched on its *name* alone has nothing to quote. Showing no
    // snippet at all reads as an empty result, so lead with the opening of the
    // page — which is what a reader wants to see to recognise it anyway.
    const opening = content.trim().slice(0, radius * 2);
    return opening ? [highlight(opening, terms)] : [];
  }

  return windows
    .sort((a, b) => a.start - b.start)
    .slice(0, maxSnippets)
    .map((window) => highlight(content.slice(window.start, window.end), terms));
}

/**
 * Splits a snippet into matched and unmatched runs.
 *
 * Segments rather than markup on purpose: the hub's service returns
 * `<highlighthit>` tags wrapped around wiki content, and the reason that is
 * parsed into segments is to keep attacker-influenced text off any innerHTML
 * path. Producing markup here would reintroduce exactly what that avoids.
 */
export function highlight(text: string, terms: readonly string[]): readonly WikiSearchSegment[] {
  const lower = text.toLowerCase();
  const marked = new Array<boolean>(text.length).fill(false);

  for (const term of terms) {
    let index = lower.indexOf(term);
    while (index >= 0) {
      marked.fill(true, index, index + term.length);
      index = lower.indexOf(term, index + term.length);
    }
  }

  const segments: WikiSearchSegment[] = [];
  let runStart = 0;
  for (let index = 1; index <= text.length; index += 1) {
    if (index === text.length || marked[index] !== marked[runStart]) {
      segments.push({ text: text.slice(runStart, index), isMatch: marked[runStart] });
      runStart = index;
    }
  }

  return segments;
}
