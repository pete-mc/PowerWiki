// Filters the page tree by page name.
//
// This is the "I know what the page is called" case, and it is deliberately not
// a search: no request, no ranking, no content. It narrows the tree already on
// screen so the structure stays visible — a matched page keeps its ancestors, so
// you can still see where in the wiki it lives. Full-text search is a separate
// affordance that renders into the content area (see WikiSearchResults).

import type { WikiPageTreeNode } from "../../wiki/WikiPageTree";

/**
 * Returns the nodes whose name matches `query`, together with their ancestors.
 *
 * Filtered nodes are marked as loaded with exactly the children that survived,
 * so the tree renders them expanded and does not offer to fetch more: an
 * expander that loads children the filter would immediately hide reads as a bug.
 */
export function filterWikiPageTree(
  nodes: readonly WikiPageTreeNode[],
  query: string
): WikiPageTreeNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [...nodes];
  }

  const filtered: WikiPageTreeNode[] = [];
  for (const node of nodes) {
    const children = filterWikiPageTree(node.children, needle);
    const selfMatches = node.name.toLowerCase().includes(needle);
    if (!selfMatches && children.length === 0) {
      continue;
    }

    filtered.push({
      ...node,
      children,
      childrenLoaded: true,
      hasChildren: children.length > 0
    });
  }

  return filtered;
}

/** Counts the pages a filtered tree actually contains, for "n of m" feedback. */
export function countWikiPageTreeNodes(nodes: readonly WikiPageTreeNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countWikiPageTreeNodes(node.children), 0);
}
