// Instant, local matching of page titles and paths.
//
// The pages already in the nav tree are in memory, so matching them costs
// nothing and answers before a search request could even leave the browser. That
// matters because the commonest search is "take me to the page I can name", and
// waiting on a round-trip for that feels broken. Content matches still come from
// the search service (see wiki/wikiSearch.ts); these two are shown together.
//
// Only loaded pages are searchable here — the tree fetches children lazily, so a
// collapsed subtree is not in `pages` yet. The server results cover the rest,
// which is why the local pass is an addition rather than a replacement.

import type { WikiSearchSegment } from "../../wiki/wikiSearch";

export interface WikiSearchablePage {
  readonly path: string;
  readonly title: string;
}

export interface WikiTitleMatch {
  readonly path: string;
  readonly title: string;
  /** Title split around the matched run, the same shape search snippets use. */
  readonly titleSegments: readonly WikiSearchSegment[];
}

const DEFAULT_LIMIT = 20;

/**
 * Ranks pages whose title or path contains `query`, best match first.
 *
 * Ranking is deliberately simple — an exact title beats a prefix, which beats a
 * title substring, which beats a path-only match — because the list is short and
 * a user scanning it should see the page they typed at the top.
 */
export function matchWikiTitles(
  pages: readonly WikiSearchablePage[],
  query: string,
  limit: number = DEFAULT_LIMIT
): readonly WikiTitleMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  return pages
    .map((page) => ({ page, rank: rankPage(page, needle) }))
    .filter((candidate) => candidate.rank < NO_MATCH)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.page.title.length - b.page.title.length ||
        a.page.path.localeCompare(b.page.path)
    )
    .slice(0, limit)
    .map(({ page }) => ({
      path: page.path,
      title: page.title,
      titleSegments: highlightSegments(page.title, needle)
    }));
}

const NO_MATCH = 9;

function rankPage(page: WikiSearchablePage, needle: string): number {
  const title = page.title.toLowerCase();
  if (title === needle) {
    return 0;
  }
  if (title.startsWith(needle)) {
    return 1;
  }
  if (title.includes(needle)) {
    return 2;
  }
  if (page.path.toLowerCase().includes(needle)) {
    return 3;
  }
  return NO_MATCH;
}

/** Marks the first occurrence of `needle` in `text`, or returns it unmarked. */
function highlightSegments(text: string, needle: string): readonly WikiSearchSegment[] {
  const index = text.toLowerCase().indexOf(needle);
  if (index < 0) {
    return [{ text, isMatch: false }];
  }

  const segments: WikiSearchSegment[] = [];
  if (index > 0) {
    segments.push({ text: text.slice(0, index), isMatch: false });
  }
  segments.push({ text: text.slice(index, index + needle.length), isMatch: true });
  if (index + needle.length < text.length) {
    segments.push({ text: text.slice(index + needle.length), isMatch: false });
  }
  return segments;
}
