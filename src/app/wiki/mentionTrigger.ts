// Deciding when an "@" the user just typed is the start of a mention.
//
// Shared by both editors: the Monaco completion provider and the rich text
// editor's popup ask the same question of the text before the caret, and they
// must answer it identically or a mention typed in one mode would be offered
// and not the other.
//
// Getting this wrong is worse than not offering the feature. An "@" is common in
// prose that has nothing to do with people — email addresses, npm scopes, handles
// quoted from elsewhere — and a picker that opens on all of them interrupts
// typing every time.

/** Longest name fragment worth searching on. Past this it is prose, not a name. */
const MAX_QUERY_LENGTH = 40;

/**
 * Name characters. Spaces are included so "@ada lov" keeps searching — people
 * type first-name-space-surname — but only single ones, so a sentence that
 * happens to follow an "@" stops matching rather than querying on every word.
 */
const MENTION_AT_END = /(?:^|\s)@([\p{L}\p{N}][\p{L}\p{N}._'-]*(?: [\p{L}\p{N}._'-]+)?)?$/u;

export interface MentionTrigger {
  /** What the user has typed after the "@", possibly empty. */
  readonly query: string;
  /** 0-based index of the "@" in the line. */
  readonly atIndex: number;
}

/**
 * Reads an active mention trigger out of the text on the current line up to the
 * caret, or null when there is not one.
 *
 * Only an "@" at the start of a line or after whitespace counts, which is what
 * keeps `someone@example.com` from opening a picker on its own address.
 */
export function matchMentionTrigger(lineUpToCaret: string): MentionTrigger | null {
  // An "@" inside a code span is being written about, not used. Backticks are
  // counted rather than parsed: the line is all the editor gives us, and an odd
  // count means the caret is inside an unclosed span.
  if (countBackticks(lineUpToCaret) % 2 === 1) {
    return null;
  }

  const match = MENTION_AT_END.exec(lineUpToCaret);
  if (!match) {
    return null;
  }

  const query = match[1] ?? "";
  if (query.length > MAX_QUERY_LENGTH) {
    return null;
  }

  return { query, atIndex: lineUpToCaret.length - query.length - 1 };
}

/**
 * True when the caret sits inside a mention that has already been written, e.g.
 * `@<a502d9c7-…`. Re-offering the picker there would replace a finished mention
 * with a fresh one mid-GUID.
 */
export function insideExistingMention(lineUpToCaret: string): boolean {
  const at = lineUpToCaret.lastIndexOf("@");
  return at !== -1 && lineUpToCaret.charAt(at + 1) === "<" && !lineUpToCaret.slice(at).includes(">");
}

function countBackticks(text: string): number {
  let count = 0;
  for (const character of text) {
    if (character === "`") {
      count += 1;
    }
  }
  return count;
}

/** The Markdown a picked identity is written as. Azure DevOps' own format. */
export function mentionMarkdown(identityId: string): string {
  return `@<${identityId}>`;
}
