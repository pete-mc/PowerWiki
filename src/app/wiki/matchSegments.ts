// Splits a label around the run that a filter matched.
//
// Shares the segment shape used by search snippets (see wiki/wikiSearch.ts) so
// one renderer covers both: a list of runs, each flagged as matched or not,
// never a string of markup. Page names come from the wiki and are therefore
// user-controlled, so keeping them as text rather than HTML is the point.

import type { WikiSearchSegment } from "../../wiki/wikiSearch";

/**
 * Returns `text` split around every case-insensitive occurrence of `query`.
 *
 * Every occurrence, not just the first: a page called "Application Assessment
 * Application" should light up both, or the highlight looks arbitrary.
 */
export function splitOnMatch(text: string, query: string): readonly WikiSearchSegment[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [{ text, isMatch: false }];
  }

  const haystack = text.toLowerCase();
  const segments: WikiSearchSegment[] = [];
  let cursor = 0;

  for (;;) {
    const index = haystack.indexOf(needle, cursor);
    if (index === -1) {
      break;
    }

    if (index > cursor) {
      segments.push({ text: text.slice(cursor, index), isMatch: false });
    }
    // Slice from the original, not the lowercased copy, so the label keeps its
    // own capitalisation rather than the query's.
    segments.push({ text: text.slice(index, index + needle.length), isMatch: true });
    cursor = index + needle.length;
  }

  if (segments.length === 0) {
    return [{ text, isMatch: false }];
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), isMatch: false });
  }

  return segments;
}
