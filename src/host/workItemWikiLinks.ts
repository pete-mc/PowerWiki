// Wiki pages linked to a work item.
//
// Azure DevOps already has a first-class link type for this — an `ArtifactLink`
// relation whose `attributes.name` is "Wiki Page" — so PowerWiki reads and
// writes the links the product itself stores rather than inventing a convention
// of its own. A page linked here shows up on the work item's Links tab too.
//
// The URL is the part worth being careful about. It looks slash-separated but
// is not: everything after `vstfs:///Wiki/WikiPage/` is a *single*
// URL-encoded string of `projectId/wikiId/pagePath`, so the separators between
// those three are `%2F` while the ones inside the page path are also `%2F`.
// Splitting the raw value on "/" therefore works right up until someone links a
// nested page, which is why parsing decodes first and splits on the known
// leading two segments.
//
// Nothing here needs the `vso.work_write` scope. These relations are read from
// and added to the *open work item form* through the host's form service, which
// acts as the signed-in user; the extension's own REST token is never used, so
// adding a link costs no extra permission and no organisation re-authorisation.

import type { LinkedWikiPage } from "./WikiHost";

const ARTIFACT_LINK_REL = "ArtifactLink";
const WIKI_LINK_NAME = "Wiki Page";
const WIKI_ARTIFACT_PREFIX = "vstfs:///Wiki/WikiPage/";

/** A work item relation, as the form service reports it. */
export interface WorkItemRelationLike {
  readonly rel?: string;
  readonly url?: string;
  readonly attributes?: { readonly [key: string]: unknown };
}

/** Builds the artifact URL Azure DevOps stores for a wiki page link. */
export function buildWikiArtifactUrl(page: Omit<LinkedWikiPage, "comment">): string {
  const path = page.path.startsWith("/") ? page.path.slice(1) : page.path;
  return WIKI_ARTIFACT_PREFIX + encodeURIComponent(`${page.projectId}/${page.wikiId}/${path}`);
}

/**
 * Reads a stored artifact URL back into its parts, or undefined if it is not a
 * wiki page link.
 */
export function parseWikiArtifactUrl(url: string): Omit<LinkedWikiPage, "comment"> | undefined {
  if (!url.startsWith(WIKI_ARTIFACT_PREFIX)) {
    return undefined;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(url.slice(WIKI_ARTIFACT_PREFIX.length));
  } catch {
    return undefined;
  }

  // Only the first two separators are structural; everything after them is the
  // page path, which contains its own slashes for nested pages.
  const firstSlash = decoded.indexOf("/");
  const secondSlash = decoded.indexOf("/", firstSlash + 1);
  if (firstSlash === -1 || secondSlash === -1) {
    return undefined;
  }

  const path = decoded.slice(secondSlash + 1);
  if (!path) {
    return undefined;
  }

  return {
    projectId: decoded.slice(0, firstSlash),
    wikiId: decoded.slice(firstSlash + 1, secondSlash),
    path: path.startsWith("/") ? path : `/${path}`,
  };
}

/** Picks the wiki page links out of a work item's relations. */
export function linkedWikiPagesFrom(relations: readonly WorkItemRelationLike[]): readonly LinkedWikiPage[] {
  const pages: LinkedWikiPage[] = [];
  for (const relation of relations) {
    // Match on the link's name rather than the URL alone: `ArtifactLink` covers
    // builds, commits, pull requests and more, all sharing the same `rel`.
    if (relation.rel !== ARTIFACT_LINK_REL || relation.attributes?.name !== WIKI_LINK_NAME) {
      continue;
    }
    const parsed = relation.url ? parseWikiArtifactUrl(relation.url) : undefined;
    if (!parsed) {
      continue;
    }
    const comment = relation.attributes?.comment;
    pages.push({ ...parsed, comment: typeof comment === "string" && comment ? comment : undefined });
  }
  return pages;
}

/** Builds the relation to hand to the form service when linking a page. */
export function wikiPageRelation(
  page: Omit<LinkedWikiPage, "comment">,
  comment?: string
): { rel: string; url: string; attributes: { name: string; comment?: string } } {
  return {
    rel: ARTIFACT_LINK_REL,
    url: buildWikiArtifactUrl(page),
    attributes: { name: WIKI_LINK_NAME, ...(comment ? { comment } : {}) },
  };
}

/** True when this work item already links the given page. */
export function alreadyLinked(relations: readonly WorkItemRelationLike[], path: string): boolean {
  return linkedWikiPagesFrom(relations).some((page) => page.path === path);
}
