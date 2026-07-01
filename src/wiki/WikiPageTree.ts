import type { WikiPageSummary } from "./WikiPage";

export type WikiOrderMap = ReadonlyMap<string, readonly string[]>;

export interface WikiPageTreeNode {
  readonly children: WikiPageTreeNode[];
  readonly hasChildren: boolean;
  readonly id?: number;
  readonly name: string;
  readonly path: string;
}

interface MutableWikiPageTreeNode {
  children: MutableWikiPageTreeNode[];
  hasChildren: boolean;
  id?: number;
  name: string;
  path: string;
}

export function buildWikiPageTree(
  pages: readonly WikiPageSummary[],
  orderMap: WikiOrderMap = new Map()
): WikiPageTreeNode[] {
  const roots: MutableWikiPageTreeNode[] = [];
  const nodesByPath = new Map<string, MutableWikiPageTreeNode>();

  for (const page of [...pages].sort(comparePagePaths)) {
    const segments = splitPagePath(page.path);
    let parentChildren = roots;
    let currentPath = "";

    segments.forEach((segment, index) => {
      currentPath = `${currentPath}/${segment}`;
      let node = nodesByPath.get(currentPath);

      if (!node) {
        node = {
          children: [],
          hasChildren: false,
          name: segment,
          path: currentPath
        };
        nodesByPath.set(currentPath, node);
        parentChildren.push(node);
      }

      if (index === segments.length - 1) {
        node.id = page.id;
      }

      if (index < segments.length - 1) {
        node.hasChildren = true;
      }

      parentChildren = node.children;
    });
  }

  return sortTree(roots, "/", orderMap);
}

function comparePagePaths(left: WikiPageSummary, right: WikiPageSummary): number {
  return left.path.localeCompare(right.path, undefined, { sensitivity: "base" });
}

function splitPagePath(path: string): string[] {
  const normalizedPath = path === "/" ? "/Home" : path;
  return normalizedPath.split("/").filter(Boolean);
}

function sortTree(
  nodes: MutableWikiPageTreeNode[],
  parentPath: string,
  orderMap: WikiOrderMap
): WikiPageTreeNode[] {
  const order = buildOrderIndex(orderMap.get(parentPath) ?? []);

  return nodes
    .sort((left, right) => compareNodes(left, right, order))
    .map((node) => ({
      children: sortTree(node.children, node.path, orderMap),
      hasChildren: node.hasChildren || node.children.length > 0,
      id: node.id,
      name: node.name,
      path: node.path
    }));
}

function buildOrderIndex(order: readonly string[]): ReadonlyMap<string, number> {
  return new Map(order.map((name, index) => [normalizeOrderName(name), index]));
}

function compareNodes(
  left: MutableWikiPageTreeNode,
  right: MutableWikiPageTreeNode,
  order: ReadonlyMap<string, number>
): number {
  const leftOrder = order.get(normalizeOrderName(left.name));
  const rightOrder = order.get(normalizeOrderName(right.name));

  if (leftOrder !== undefined && rightOrder !== undefined) {
    return leftOrder - rightOrder;
  }

  if (leftOrder !== undefined) {
    return -1;
  }

  if (rightOrder !== undefined) {
    return 1;
  }

  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

function normalizeOrderName(name: string): string {
  return name.replace(/\.md$/i, "").toLocaleLowerCase();
}
