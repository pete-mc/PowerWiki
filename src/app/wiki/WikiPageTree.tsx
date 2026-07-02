import { useEffect, useMemo, useState } from "react";

import type { WikiPageTreeNode } from "../../wiki/WikiPageTree";

interface WikiPageTreeProps {
  readonly activePath?: string;
  readonly isLoading?: boolean;
  readonly nodes: readonly WikiPageTreeNode[];
  readonly onNodeExpand?: (path: string) => void;
  readonly onPageSelected: (path: string) => void;
}

export function WikiPageTree({ activePath, isLoading = false, nodes, onNodeExpand, onPageSelected }: WikiPageTreeProps) {
  const activeAncestors = useMemo(() => findActiveAncestors(nodes, activePath), [activePath, nodes]);

  if (nodes.length === 0) {
    if (isLoading) {
      return <p aria-live="polite">Loading wiki.</p>;
    }

    return <p>No pages were found in this wiki.</p>;
  }

  return (
    <ul className="wiki-page-tree">
      {nodes.map((node) => (
        <WikiPageTreeItem
          activePath={activePath}
          // A node should be expanded if it is an ancestor of the active page.
          // We combine two strategies so it works both before and after lazy
          // children are loaded:
          //   1. Tree traversal (findActiveAncestors): works once children are
          //      in memory.
          //   2. Path-string prefix check: works immediately, even when the
          //      subtree hasn't been fetched yet. This is what lets the tree
          //      auto-cascade-expand on deep-link restore without pre-loading.
          initialExpanded={
            activeAncestors.has(node.path) || isAncestorOfActivePath(node.path, activePath)
          }
          key={node.path}
          node={node}
          onNodeExpand={onNodeExpand}
          onPageSelected={onPageSelected}
        />
      ))}
    </ul>
  );
}

interface WikiPageTreeItemProps {
  readonly activePath?: string;
  readonly initialExpanded?: boolean;
  readonly node: WikiPageTreeNode;
  readonly onNodeExpand?: (path: string) => void;
  readonly onPageSelected: (path: string) => void;
}

function WikiPageTreeItem({
  activePath,
  initialExpanded,
  node,
  onNodeExpand,
  onPageSelected
}: WikiPageTreeItemProps) {
  const isActive = activePath === node.path;
  const [expanded, setExpanded] = useState(Boolean(initialExpanded));

  useEffect(() => {
    if (initialExpanded) {
      setExpanded(true);
    }
  }, [initialExpanded]);

  // When this node is first expanded and its children haven't been loaded yet,
  // ask the parent to fetch them.
  useEffect(() => {
    if (expanded && node.hasChildren && !node.childrenLoaded) {
      onNodeExpand?.(node.path);
    }
  }, [expanded, node.hasChildren, node.childrenLoaded, node.path, onNodeExpand]);

  const showChildren = expanded && node.children.length > 0;
  const showLoadingIndicator = expanded && node.hasChildren && !node.childrenLoaded;

  return (
    <li>
      <div className="wiki-page-tree-row">
        <button
          aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
          className="wiki-page-tree-toggle"
          disabled={!node.hasChildren}
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {node.hasChildren ? (expanded ? "▾" : "▸") : ""}
        </button>
        <button
          aria-current={isActive ? "page" : undefined}
          className={isActive ? "active" : undefined}
          onClick={() => onPageSelected(node.path)}
          type="button"
        >
          {node.name}
        </button>
      </div>
      {showLoadingIndicator ? (
        <p className="wiki-tree-loading" aria-live="polite">Loading…</p>
      ) : showChildren ? (
        <WikiPageTree
          activePath={activePath}
          nodes={node.children}
          onNodeExpand={onNodeExpand}
          onPageSelected={onPageSelected}
        />
      ) : null}
    </li>
  );
}

function findActiveAncestors(
  nodes: readonly WikiPageTreeNode[],
  activePath: string | undefined
): ReadonlySet<string> {
  const ancestors = new Set<string>();

  if (!activePath) {
    return ancestors;
  }

  findActivePath(nodes, activePath, [], ancestors);
  return ancestors;
}

function findActivePath(
  nodes: readonly WikiPageTreeNode[],
  activePath: string,
  path: readonly string[],
  ancestors: Set<string>
): boolean {
  for (const node of nodes) {
    const nodePath = [...path, node.path];

    if (node.path === activePath) {
      path.forEach((ancestor) => ancestors.add(ancestor));
      return true;
    }

    if (findActivePath(node.children, activePath, nodePath, ancestors)) {
      ancestors.add(node.path);
      return true;
    }
  }

  return false;
}

/** Returns true when nodePath is a strict ancestor of activePath by path segments. */
function isAncestorOfActivePath(nodePath: string, activePath: string | undefined): boolean {
  if (!activePath) {
    return false;
  }
  return activePath.startsWith(nodePath + "/");
}
