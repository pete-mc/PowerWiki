import { useEffect, useRef } from "react";

import { appendInlineSvg } from "../../rendering/inlineSvg";
import type { LinkedWorkItem } from "../../workItems/LinkedWorkItem";
import { isClosedWorkItem } from "../../workItems/linkedWorkItemOrder";
import { CloseIcon } from "./WikiPageIcons";

interface WikiLinkedWorkItemsPanelProps {
  readonly items: readonly LinkedWorkItem[];
  /** Inline SVG per work item type name. Decorative; a missing entry is fine. */
  readonly icons?: ReadonlyMap<string, string>;
  readonly error?: string;
  readonly loading: boolean;
  readonly onClose: () => void;
  /** Opens a work item in whatever the host uses — a dialog in the Azure DevOps hub. */
  readonly onOpen: (id: number) => void;
}

/**
 * Right-hand drawer listing the work items that link to the current page.
 *
 * Read-only by design. The link lives on the work item as an `ArtifactLink`
 * relation, so creating or removing one from here would mean writing to the work
 * item — which needs the `vso.work_write` scope PowerWiki deliberately does not
 * ask for. Opening the item is offered instead: the work item form owns its own
 * links, and it is one click away.
 */
export function WikiLinkedWorkItemsPanel({
  items,
  icons,
  error,
  loading,
  onClose,
  onOpen,
}: WikiLinkedWorkItemsPanelProps) {
  return (
    <aside className="powerwiki-sidecar powerwiki-linked-work-items" aria-label="Linked work items">
      <div className="powerwiki-sidecar-header">
        <h2>Linked work items</h2>
        <button
          aria-label="Close linked work items"
          className="powerwiki-sidecar-close"
          onClick={onClose}
          type="button"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="powerwiki-sidecar-list">
        {loading ? (
          <p className="powerwiki-sidecar-status" aria-live="polite">
            Loading linked work items…
          </p>
        ) : error ? (
          <p className="powerwiki-sidecar-status" role="alert">
            {error}
          </p>
        ) : items.length === 0 ? (
          <p className="powerwiki-sidecar-status">
            No work items link to this page. Link one from a work item&rsquo;s Power Wiki tab.
          </p>
        ) : (
          <ul className="powerwiki-work-item-list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  className={
                    isClosedWorkItem(item) ? "powerwiki-work-item closed" : "powerwiki-work-item"
                  }
                  onClick={() => onOpen(item.id)}
                  title={`Open ${item.type ?? "work item"} ${item.id}`}
                  type="button"
                >
                  <span className="powerwiki-work-item-head">
                    <WorkItemTypeIcon svg={item.type ? icons?.get(item.type) : undefined} />
                    <span className="powerwiki-work-item-id">{item.id}</span>
                    {item.state ? <span className="powerwiki-work-item-state">{item.state}</span> : null}
                  </span>
                  <span className="powerwiki-work-item-title">{item.title ?? `Work item ${item.id}`}</span>
                  {item.assignedToName ? (
                    <span className="powerwiki-work-item-assignee">{item.assignedToName}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

/**
 * The work item type's icon, as Azure DevOps serves it.
 *
 * The markup is a string from the service rather than a component, so it is
 * parsed and imported through `appendInlineSvg` instead of being handed to
 * `dangerouslySetInnerHTML`.
 */
function WorkItemTypeIcon({ svg }: { readonly svg?: string }) {
  const host = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) {
      return;
    }
    element.replaceChildren();
    if (svg) {
      appendInlineSvg(element, svg);
    }
  }, [svg]);

  return <span aria-hidden="true" className="powerwiki-work-item-icon" ref={host} />;
}
