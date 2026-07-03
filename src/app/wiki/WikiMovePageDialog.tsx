import { useEffect, useState } from "react";

import type { WikiPageTreeNode } from "../../wiki/WikiPageTree";
import { ChevronIcon, HomeIcon, PageIcon } from "./WikiPageIcons";

interface WikiMovePageDialogProps {
  readonly homePath?: string;
  readonly movingPath: string;
  readonly nodes: readonly WikiPageTreeNode[];
  readonly onCancel: () => void;
  readonly onConfirm: (destinationParentPath: string) => void;
  readonly onExpand: (path: string) => void;
}

/**
 * Modal for choosing where to move a page. Presents the wiki hierarchy as a
 * selectable tree of destination parents (plus the top level); the moving page
 * and its own descendants are disabled because a page cannot be moved into
 * itself. Confirming reports the chosen parent path back to the caller.
 */
export function WikiMovePageDialog({
  homePath,
  movingPath,
  nodes,
  onCancel,
  onConfirm,
  onExpand,
}: WikiMovePageDialogProps) {
  const currentParent = parentPath(movingPath);
  const [selected, setSelected] = useState<string>(currentParent);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const canConfirm = selected !== currentParent;

  return (
    <div className="wiki-dialog-overlay" onClick={onCancel} role="presentation">
      <div
        aria-labelledby="wiki-move-dialog-title"
        aria-modal="true"
        className="wiki-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <h2 className="wiki-dialog-title" id="wiki-move-dialog-title">
          Move &ldquo;{lastSegment(movingPath)}&rdquo;
        </h2>
        <p className="wiki-dialog-subtitle">Choose a new parent location.</p>

        <div className="wiki-dialog-tree">
          <button
            className={selected === "/" ? "wiki-move-option selected" : "wiki-move-option"}
            onClick={() => setSelected("/")}
            type="button"
          >
            <span className="wiki-page-tree-icon"><HomeIcon /></span>
            <span className="wiki-page-tree-label">Top level</span>
          </button>
          <MoveDestinationList
            homePath={homePath}
            movingPath={movingPath}
            nodes={nodes}
            onExpand={onExpand}
            onSelect={setSelected}
            selected={selected}
          />
        </div>

        <div className="wiki-dialog-actions">
          <button
            className="wiki-dialog-primary"
            disabled={!canConfirm}
            onClick={() => onConfirm(selected)}
            type="button"
          >
            Move
          </button>
          <button className="wiki-dialog-secondary" onClick={onCancel} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

interface MoveDestinationListProps {
  readonly homePath?: string;
  readonly movingPath: string;
  readonly nodes: readonly WikiPageTreeNode[];
  readonly onExpand: (path: string) => void;
  readonly onSelect: (path: string) => void;
  readonly selected: string;
}

function MoveDestinationList({
  homePath,
  movingPath,
  nodes,
  onExpand,
  onSelect,
  selected,
}: MoveDestinationListProps) {
  return (
    <ul className="wiki-move-list">
      {nodes.map((node) => (
        <MoveDestinationItem
          homePath={homePath}
          key={node.path}
          movingPath={movingPath}
          node={node}
          onExpand={onExpand}
          onSelect={onSelect}
          selected={selected}
        />
      ))}
    </ul>
  );
}

interface MoveDestinationItemProps {
  readonly homePath?: string;
  readonly movingPath: string;
  readonly node: WikiPageTreeNode;
  readonly onExpand: (path: string) => void;
  readonly onSelect: (path: string) => void;
  readonly selected: string;
}

function MoveDestinationItem({
  homePath,
  movingPath,
  node,
  onExpand,
  onSelect,
  selected,
}: MoveDestinationItemProps) {
  const [expanded, setExpanded] = useState(false);
  // The page being moved (and anything beneath it) cannot receive itself.
  const disabled = node.path === movingPath || node.path.startsWith(`${movingPath}/`);

  useEffect(() => {
    if (expanded && node.hasChildren && !node.childrenLoaded) {
      onExpand(node.path);
    }
  }, [expanded, node.childrenLoaded, node.hasChildren, node.path, onExpand]);

  return (
    <li>
      <div className={selected === node.path ? "wiki-move-option selected" : "wiki-move-option"}>
        <button
          aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
          className="wiki-page-tree-toggle"
          disabled={!node.hasChildren}
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {node.hasChildren ? <ChevronIcon className={expanded ? "expanded" : undefined} /> : null}
        </button>
        <button
          className="wiki-move-option-label"
          disabled={disabled}
          onClick={() => onSelect(node.path)}
          type="button"
        >
          <span className="wiki-page-tree-icon">
            {node.path === homePath ? <HomeIcon /> : <PageIcon />}
          </span>
          <span className="wiki-page-tree-label">{node.name}</span>
        </button>
      </div>
      {expanded && node.children.length > 0 ? (
        <MoveDestinationList
          homePath={homePath}
          movingPath={movingPath}
          nodes={node.children}
          onExpand={onExpand}
          onSelect={onSelect}
          selected={selected}
        />
      ) : null}
    </li>
  );
}

function parentPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return "/";
  }
  return "/" + segments.slice(0, -1).join("/");
}

function lastSegment(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}
