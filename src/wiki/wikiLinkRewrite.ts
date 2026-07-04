// Rewrites Markdown links after a page rename/move so inbound links from other
// pages keep working. Handles absolute wiki-path destinations (the form the
// page-link picker and the built-in wiki produce), including links to the moved
// page's descendants and anchors, in both raw and percent-encoded styles.
// Relative links are intentionally left alone: resolving them needs the linking
// page's own path and they are rare in ADO wikis.

export interface LinkRewriteResult {
  readonly content: string;
  readonly count: number;
}

// Markdown inline link/image destination: "](dest)" with an optional title.
const LINK_DESTINATION = /(\]\()([^()\s]+)((?:\s+"[^"]*")?\))/g;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Rewrites links pointing at oldPath (or its descendants/anchors) to newPath. */
export function rewriteWikiLinks(markdown: string, oldPath: string, newPath: string): LinkRewriteResult {
  let count = 0;

  const content = markdown.replace(LINK_DESTINATION, (full, open: string, dest: string, close: string) => {
    const decoded = safeDecode(dest);
    if (
      decoded !== oldPath &&
      !decoded.startsWith(`${oldPath}/`) &&
      !decoded.startsWith(`${oldPath}#`)
    ) {
      return full;
    }

    const suffix = decoded.slice(oldPath.length);
    const rewritten = newPath + suffix;
    count += 1;
    // Preserve the original encoding style: if the destination was
    // percent-encoded, keep it encoded; otherwise emit the raw path.
    const emitted = dest !== decoded ? encodeURI(rewritten) : rewritten;
    return `${open}${emitted}${close}`;
  });

  return { content, count };
}
