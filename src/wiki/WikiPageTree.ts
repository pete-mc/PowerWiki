import type { WikiPageSummary } from "./WikiPage";

export interface WikiPageTreeNode {
  readonly children: WikiPageTreeNode[];
  readonly id?: number;
  readonly name: string;
  readonly path: string;
}

interface MutableWikiPageTreeNode {
  children: MutableWikiPageTreeNode[];
  id?: number;
  name: string;
  path: string;
}

export function buildWikiPageTree(pages: readonly WikiPageSummary[]): WikiPageTreeNode[] {
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
          name: segment,
          path: currentPath
        };
        nodesByPath.set(currentPath, node);
        parentChildren.push(node);
      }

      if (index === segments.length - 1) {
        node.id = page.id;
      }

      parentChildren = node.children;
    });
  }

  return sortTree(roots);
}

function comparePagePaths(left: WikiPageSummary, right: WikiPageSummary): number {
  return left.path.localeCompare(right.path, undefined, { sensitivity: "base" });
}

function splitPagePath(path: string): string[] {
  const normalizedPath = path === "/" ? "/Home" : path;
  return normalizedPath.split("/").filter(Boolean);
}

function sortTree(nodes: MutableWikiPageTreeNode[]): WikiPageTreeNode[] {
  return nodes
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
    .map((node) => ({
      children: sortTree(node.children),
      id: node.id,
      name: node.name,
      path: node.path
    }));
}

