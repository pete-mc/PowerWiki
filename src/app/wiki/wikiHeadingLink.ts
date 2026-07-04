// Shareable deep links to a heading within a PowerWiki page.
//
// PowerWiki is a hash-routed hub, so a heading anchor cannot be a second `#`
// fragment (a URL has only one). Instead the heading slug is carried inside the
// route hash after an `&anchor=` marker, e.g.
//   https://dev.azure.com/org/project/_apps/hub/pub.ext.wiki#/Page&anchor=slug
// The app parses the marker on load and scrolls to the matching heading.
//
// A plain `#slug` permalink (markdown-it-anchor's default) is useless when
// copied: the browser resolves it against the extension iframe's own CDN URL,
// not the Azure DevOps page — which is the bug this addresses.

const ANCHOR_MARKER = "&anchor=";

export interface HubLinkContext {
  readonly organizationName?: string;
  readonly projectName?: string;
  readonly organizationIsHosted?: boolean;
  /** Full contribution id of the current hub, e.g. "publisher.ext.wiki". */
  readonly contributionId?: string;
}

/** Splits a route hash (with or without a leading #) into page hash + anchor. */
export function splitHashAnchor(hash: string): { pageHash: string; anchor?: string } {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const index = raw.indexOf(ANCHOR_MARKER);
  if (index < 0) {
    return { pageHash: raw };
  }

  const rawAnchor = raw.slice(index + ANCHOR_MARKER.length);
  let anchor = rawAnchor;
  try {
    anchor = decodeURIComponent(rawAnchor);
  } catch {
    // Keep the raw value if it isn't valid percent-encoding.
  }

  return { pageHash: raw.slice(0, index), anchor: anchor || undefined };
}

/** Appends (replacing any existing) an anchor slug to a page route hash. */
export function withHashAnchor(pageHash: string, slug: string): string {
  const { pageHash: base } = splitHashAnchor(pageHash);
  return `${base}${ANCHOR_MARKER}${encodeURIComponent(slug)}`;
}

/**
 * Absolute dev.azure.com URL for a PowerWiki hub route hash, optionally deep
 * linked to a heading. Returns undefined for on-prem/unknown contexts, where the
 * host base can't be constructed — callers keep the default in-page anchor then.
 */
export function buildHubPageUrl(context: HubLinkContext, pageHash: string, slug?: string): string | undefined {
  const { organizationName, projectName, organizationIsHosted, contributionId } = context;
  if (!organizationName || !projectName || !organizationIsHosted || !contributionId) {
    return undefined;
  }

  const hash = slug ? withHashAnchor(pageHash, slug) : pageHash;
  const normalized = hash.startsWith("/") ? hash : `/${hash}`;
  return (
    `https://dev.azure.com/${encodeURIComponent(organizationName)}/${encodeURIComponent(projectName)}` +
    `/_apps/hub/${contributionId}#${normalized}`
  );
}
