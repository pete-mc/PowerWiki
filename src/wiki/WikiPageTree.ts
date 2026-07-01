import type { WikiPageSummary } from "./WikiPage";

export interface WikiPageTreeNode {
  readonly children: WikiPageTreeNode[];
  /** True once getChildPages has been called for this node's path. */
  readonly childrenLoaded: boolean;
  readonly hasChildren: boolean;
  readonly id?: number;
  readonly name: string;
  readonly order: number;
  readonly path: string;
}

interface MutableWikiPageTreeNode {
  children: MutableWikiPageTreeNode[];
  childrenLoaded: boolean;
  hasChildren: boolean;
  id?: number;
  name: string;
  order: number;
  path: string;
}

/**
 * Builds a display tree from the flat list of fetched pages.
 *
 * @param pages      All pages fetched so far (may be a subset of the full wiki).
 * @param loadedPaths Paths for which getChildPages has already been called.
 *                    Controls whether a node shows a load-on-expand indicator.
 */
export function buildWikiPageTree(
  pages: readonly WikiPageSummary[],
  loadedPaths: ReadonlySet<string> = new Set()
): WikiPageTreeNode[] {
  const nodesByPath = new Map<string, MutableWikiPageTreeNode>();

  for (const page of pages) {
    const segments = page.path.split("/").filter(Boolean);
    const name = segments.at(-1) ?? page.path;

    nodesByPath.set(page.path, {
      children: [],
      childrenLoaded: loadedPaths.has(page.path),
      hasChildren: page.isParentPage,
      id: page.id,
      name,
      order: page.order,
      path: page.path,
    });
  }

  const roots: MutableWikiPageTreeNode[] = [];

  for (const node of nodesByPath.values()) {
    const segments = node.path.split("/").filter(Boolean);
    const parentPath =
      segments.length <= 1 ? null : "/" + segments.slice(0, -1).join("/");

    const parent = parentPath ? nodesByPath.get(parentPath) : null;

    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  sortByOrder(roots);
  return roots;
}

function sortByOrder(nodes: MutableWikiPageTreeNode[]): void {
  nodes.sort((a, b) => a.order - b.order);
  for (const node of nodes) {
    sortByOrder(node.children);
  }
}
