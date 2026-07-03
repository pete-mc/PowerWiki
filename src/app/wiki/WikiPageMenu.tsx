import { useEffect, useRef, useState, type ReactNode } from "react";

import { MoreIcon } from "./WikiPageIcons";

export interface WikiPageMenuItem {
  readonly destructive?: boolean;
  readonly icon?: ReactNode;
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
}

interface WikiPageMenuProps {
  readonly items: readonly WikiPageMenuItem[];
  readonly label: string;
}

interface MenuCoords {
  readonly right: number;
  readonly top: number;
}

/**
 * A kebab (⋮) button that opens a small context menu for a single tree row.
 *
 * The popover is positioned with `position: fixed` (anchored to the trigger)
 * so it is not clipped by the scrollable navigation panel. It closes on outside
 * click, Escape, scroll, resize, or after an item is chosen.
 */
export function WikiPageMenu({ items, label }: WikiPageMenuProps) {
  const [coords, setCoords] = useState<MenuCoords | undefined>(undefined);
  const containerRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const open = coords !== undefined;

  useEffect(() => {
    if (!open) {
      return;
    }

    function close() {
      setCoords(undefined);
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        close();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    // Capture scroll from any ancestor (the tree panel) so the menu doesn't
    // drift away from its anchor.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setCoords(undefined);
      return;
    }

    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setCoords({ top: rect.bottom + 2, right: window.innerWidth - rect.right });
    }
  }

  return (
    <span className="wiki-page-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="wiki-page-menu-trigger"
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        ref={triggerRef}
        type="button"
      >
        <MoreIcon />
      </button>
      {coords ? (
        <div
          className="wiki-page-menu-popover"
          role="menu"
          style={{ position: "fixed", top: coords.top, right: coords.right }}
        >
          {items.map((item) => (
            <button
              className={item.destructive ? "destructive" : undefined}
              key={item.id}
              onClick={(event) => {
                event.stopPropagation();
                setCoords(undefined);
                item.onSelect();
              }}
              role="menuitem"
              type="button"
            >
              {item.icon ? <span className="wiki-page-menu-icon">{item.icon}</span> : null}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
