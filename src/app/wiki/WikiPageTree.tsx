import type { WikiPageTreeNode } from "../../wiki/WikiPageTree";

interface WikiPageTreeProps {
  readonly activePath?: string;
  readonly nodes: readonly WikiPageTreeNode[];
  readonly onPageSelected: (path: string) => void;
}

export function WikiPageTree({ activePath, nodes, onPageSelected }: WikiPageTreeProps) {
  if (nodes.length === 0) {
    return <p>No pages were found in this wiki.</p>;
  }

  return (
    <ul className="wiki-page-tree">
      {nodes.map((node) => (
        <WikiPageTreeItem
          activePath={activePath}
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
  readonly node: WikiPageTreeNode;
  readonly onPageSelected: (path: string) => void;
}

function WikiPageTreeItem({ activePath, node, onPageSelected }: WikiPageTreeItemProps) {
  const isActive = activePath === node.path;
  const canSelect = node.id !== undefined;

  return (
    <li>
      <button
        aria-current={isActive ? "page" : undefined}
        className={isActive ? "active" : undefined}
        disabled={!canSelect}
        onClick={() => onPageSelected(node.path)}
        type="button"
      >
        {node.name}
      </button>
      {node.children.length > 0 ? (
        <WikiPageTree
          activePath={activePath}
          nodes={node.children}
          onPageSelected={onPageSelected}
        />
      ) : null}
    </li>
  );
}

