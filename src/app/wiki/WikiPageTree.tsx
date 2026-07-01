import { useEffect, useMemo, useState } from "react";

import type { WikiPageTreeNode } from "../../wiki/WikiPageTree";

interface WikiPageTreeProps {
  readonly activePath?: string;
  readonly nodes: readonly WikiPageTreeNode[];
  readonly onPageSelected: (path: string) => void;
}

export function WikiPageTree({ activePath, nodes, onPageSelected }: WikiPageTreeProps) {
  const activeAncestors = useMemo(() => findActiveAncestors(nodes, activePath), [activePath, nodes]);

  if (nodes.length === 0) {
    return <p>No pages were found in this wiki.</p>;
  }

  return (
    <ul className="wiki-page-tree">
      {nodes.map((node) => (
        <WikiPageTreeItem
          activePath={activePath}
          initialExpanded={activeAncestors.has(node.path)}
          key={node.path}
          node={node}
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
  readonly onPageSelected: (path: string) => void;
}

function WikiPageTreeItem({
  activePath,
  initialExpanded,
  node,
  onPageSelected
}: WikiPageTreeItemProps) {
  const isActive = activePath === node.path;
  const canSelect = node.id !== undefined;
  const [expanded, setExpanded] = useState(Boolean(initialExpanded));

  useEffect(() => {
    if (initialExpanded) {
      setExpanded(true);
    }
  }, [initialExpanded]);

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
          {node.hasChildren ? (expanded ? "v" : ">") : ""}
        </button>
        <button
          aria-current={isActive ? "page" : undefined}
          className={isActive ? "active" : undefined}
          disabled={!canSelect}
          onClick={() => onPageSelected(node.path)}
          type="button"
        >
          {node.name}
        </button>
      </div>
      {expanded && node.children.length > 0 ? (
        <WikiPageTree
          activePath={activePath}
          nodes={node.children}
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
