import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type DragEvent
} from "react";

import type { WikiPageTreeNode } from "../../wiki/WikiPageTree";
import { ChevronIcon, HomeIcon, PageIcon } from "./WikiPageIcons";
import { WikiPageMenu, type WikiPageMenuItem } from "./WikiPageMenu";

/** Where a dragged page lands relative to the row it is dropped on. */
type DropPosition = "after" | "before" | "inside";

export interface WikiPageTreeActions {
  readonly onAddSubPage: (path: string) => void;
  readonly onCopyPath: (path: string) => void;
  readonly onDeletePage: (path: string) => void;
  readonly onEditPage: (path: string) => void;
  readonly onMoveNode: (sourcePath: string, newPath: string, newOrder: number) => void;
  readonly onMovePagePrompt: (path: string) => void;
  readonly onNodeExpand: (path: string) => void;
  readonly onOpenInNewTab: (path: string) => void;
  readonly onPageSelected: (path: string) => void;
}

interface DropTarget {
  readonly path: string;
  readonly position: DropPosition;
}

interface WikiPageTreeContextValue {
  readonly actions: WikiPageTreeActions;
  readonly activeAncestors: ReadonlySet<string>;
  readonly activePath?: string;
  readonly draggedPath?: string;
  readonly dropTarget?: DropTarget;
  readonly homePath?: string;
  readonly setDraggedPath: (path?: string) => void;
  readonly setDropTarget: (target?: DropTarget) => void;
}

const WikiPageTreeContext = createContext<WikiPageTreeContextValue | undefined>(undefined);

function useWikiPageTreeContext(): WikiPageTreeContextValue {
  const context = useContext(WikiPageTreeContext);
  if (!context) {
    throw new Error("WikiPageTree components must be rendered inside WikiPageTree.");
  }
  return context;
}

interface WikiPageTreeProps {
  readonly actions: WikiPageTreeActions;
  readonly activePath?: string;
  readonly isLoading?: boolean;
  readonly nodes: readonly WikiPageTreeNode[];
}

export function WikiPageTree({ actions, activePath, isLoading = false, nodes }: WikiPageTreeProps) {
  const [draggedPath, setDraggedPath] = useState<string | undefined>(undefined);
  const [dropTarget, setDropTarget] = useState<DropTarget | undefined>(undefined);
  const activeAncestors = useMemo(() => findActiveAncestors(nodes, activePath), [activePath, nodes]);
  // The first root page (lowest order) is treated as the wiki home page and
  // shown with a home icon, matching the built-in Azure DevOps wiki.
  const homePath = nodes[0]?.path;

  const contextValue = useMemo<WikiPageTreeContextValue>(
    () => ({
      actions,
      activeAncestors,
      activePath,
      draggedPath,
      dropTarget,
      homePath,
      setDraggedPath,
      setDropTarget,
    }),
    [actions, activeAncestors, activePath, draggedPath, dropTarget, homePath]
  );

  if (nodes.length === 0) {
    if (isLoading) {
      return <p className="wiki-tree-empty" aria-live="polite">Loading wiki.</p>;
    }

    return <p className="wiki-tree-empty">No pages were found in this wiki.</p>;
  }

  return (
    <WikiPageTreeContext.Provider value={contextValue}>
      <WikiPageTreeList nodes={nodes} />
    </WikiPageTreeContext.Provider>
  );
}

function WikiPageTreeList({ nodes }: { readonly nodes: readonly WikiPageTreeNode[] }) {
  const { activeAncestors, activePath } = useWikiPageTreeContext();

  return (
    <ul className="wiki-page-tree">
      {nodes.map((node) => (
        <WikiPageTreeItem
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
        />
      ))}
    </ul>
  );
}

interface WikiPageTreeItemProps {
  readonly initialExpanded?: boolean;
  readonly node: WikiPageTreeNode;
}

function WikiPageTreeItem({ initialExpanded, node }: WikiPageTreeItemProps) {
  const { actions, activePath, draggedPath, dropTarget, homePath, setDraggedPath, setDropTarget } =
    useWikiPageTreeContext();
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
      actions.onNodeExpand(node.path);
    }
  }, [actions, expanded, node.hasChildren, node.childrenLoaded, node.path]);

  const showChildren = expanded && node.children.length > 0;
  const showLoadingIndicator = expanded && node.hasChildren && !node.childrenLoaded;
  const isBeingDragged = draggedPath === node.path;
  const activeDrop = dropTarget?.path === node.path ? dropTarget.position : undefined;

  function handleDragStart(event: DragEvent<HTMLDivElement>) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", node.path);
    setDraggedPath(node.path);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!draggedPath || draggedPath === node.path) {
      return;
    }

    const position = resolveDropPosition(event, node, draggedPath);
    if (!position) {
      event.dataTransfer.dropEffect = "none";
      if (dropTarget?.path === node.path) {
        setDropTarget(undefined);
      }
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropTarget?.path !== node.path || dropTarget.position !== position) {
      setDropTarget({ path: node.path, position });
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const sourcePath = draggedPath ?? event.dataTransfer.getData("text/plain");
    const position = dropTarget?.path === node.path ? dropTarget.position : undefined;
    setDraggedPath(undefined);
    setDropTarget(undefined);

    if (!sourcePath || !position) {
      return;
    }

    const move = computeMove(sourcePath, node, position);
    if (move) {
      actions.onMoveNode(sourcePath, move.newPath, move.newOrder);
    }
  }

  function handleDragEnd() {
    setDraggedPath(undefined);
    setDropTarget(undefined);
  }

  const rowClassName = [
    "wiki-page-tree-row",
    isActive ? "active" : "",
    isBeingDragged ? "dragging" : "",
    activeDrop ? `drop-${activeDrop}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li>
      <div
        className={rowClassName}
        draggable
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart}
        onDrop={handleDrop}
      >
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
          aria-current={isActive ? "page" : undefined}
          className="wiki-page-tree-link"
          onClick={() => actions.onPageSelected(node.path)}
          type="button"
        >
          <span className="wiki-page-tree-icon">
            {node.path === homePath ? <HomeIcon /> : <PageIcon />}
          </span>
          <span className="wiki-page-tree-label">{node.name}</span>
        </button>
        <WikiPageMenu items={buildMenuItems(node.path, actions)} label={`Actions for ${node.name}`} />
      </div>
      {showLoadingIndicator ? (
        <p className="wiki-tree-loading" aria-live="polite">Loading…</p>
      ) : showChildren ? (
        <WikiPageTreeList nodes={node.children} />
      ) : null}
    </li>
  );
}

function buildMenuItems(path: string, actions: WikiPageTreeActions): WikiPageMenuItem[] {
  return [
    { id: "add-sub-page", label: "Add sub-page", onSelect: () => actions.onAddSubPage(path) },
    { id: "copy-path", label: "Copy page path", onSelect: () => actions.onCopyPath(path) },
    { id: "move", label: "Move page", onSelect: () => actions.onMovePagePrompt(path) },
    { id: "edit", label: "Edit", onSelect: () => actions.onEditPage(path) },
    { id: "open-new-tab", label: "Open in new tab", onSelect: () => actions.onOpenInNewTab(path) },
    { id: "delete", label: "Delete", destructive: true, onSelect: () => actions.onDeletePage(path) },
  ];
}

/**
 * Determines where a dragged page would land given the pointer position within
 * a row: the top and bottom quarters reorder it as a sibling before/after the
 * target, the middle reparents it as a child. Returns undefined when the move
 * is invalid (dropping onto itself or one of its own descendants).
 */
function resolveDropPosition(
  event: DragEvent<HTMLDivElement>,
  node: WikiPageTreeNode,
  draggedPath: string
): DropPosition | undefined {
  if (isSelfOrDescendant(node.path, draggedPath)) {
    return undefined;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;

  if (ratio < 0.25) {
    return "before";
  }
  if (ratio > 0.75) {
    return "after";
  }
  return "inside";
}

function computeMove(
  draggedPath: string,
  targetNode: WikiPageTreeNode,
  position: DropPosition
): { newOrder: number; newPath: string } | undefined {
  if (isSelfOrDescendant(targetNode.path, draggedPath)) {
    return undefined;
  }

  const name = lastSegment(draggedPath);

  if (position === "inside") {
    return {
      newPath: joinPath(targetNode.path, name),
      newOrder: targetNode.children.length,
    };
  }

  const newParent = parentPath(targetNode.path);
  const newPath = joinPath(newParent, name);
  const newOrder = position === "before" ? targetNode.order : targetNode.order + 1;

  // A no-op reorder (dropping a page immediately next to itself in the same
  // parent at its current slot) still round-trips through the API harmlessly.
  return { newPath, newOrder };
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

function joinPath(parent: string, name: string): string {
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

function isSelfOrDescendant(candidate: string, ancestor: string): boolean {
  return candidate === ancestor || candidate.startsWith(ancestor + "/");
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
