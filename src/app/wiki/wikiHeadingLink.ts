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

/**
 * Query parameter that carries the route in a shareable link, alongside the
 * hash. A link opened without an Azure DevOps session goes through sign-in,
 * and that round trip keeps only the path and query: `reply_to` is built
 * server-side, where the fragment never arrives, and the sign-in redirect sets
 * a fragment of its own. The route in the hash was lost, so the link opened the
 * wiki's home page, and worked on the second try only because by then the user
 * was signed in. The host reads this parameter on load (see
 * `azureDevOpsWikiHost.ts`).
 */
export const HUB_ROUTE_PARAM = "route";

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
 * linked to a heading. The route goes in both the query (survives sign-in) and
 * the hash (what the app has always read). Returns undefined for on-prem/unknown contexts, where the
 * host base can't be constructed — callers keep the default in-page anchor then.
 */
export function buildHubPageUrl(context: HubLinkContext, pageHash: string, slug?: string): string | undefined {
  const { organizationName, projectName, organizationIsHosted, contributionId } = context;
  if (!organizationName || !projectName || !organizationIsHosted || !contributionId) {
    return undefined;
  }

  const hash = slug ? withHashAnchor(pageHash, slug) : pageHash;
  const normalized = hash.startsWith("/") ? hash : `/${hash}`;
  // Slashes are left readable; everything else is escaped so the value comes
  // back from the query exactly as the route hash it was built from.
  const query = encodeURIComponent(normalized).replace(/%2F/g, "/");
  return (
    `https://dev.azure.com/${encodeURIComponent(organizationName)}/${encodeURIComponent(projectName)}` +
    `/_apps/hub/${contributionId}?${HUB_ROUTE_PARAM}=${query}#${normalized}`
  );
}
