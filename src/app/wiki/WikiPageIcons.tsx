// Small inline SVG icons used by the wiki navigation panel. Kept together so the
// tree, panel footer, and context menu share one visual vocabulary. Each icon
// inherits currentColor and is sized via the surrounding button/element.

interface IconProps {
  readonly className?: string;
}

const ICON_PROPS = {
  "aria-hidden": true,
  fill: "none",
  focusable: false,
  height: 16,
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.6,
  viewBox: "0 0 16 16",
  width: 16,
  xmlns: "http://www.w3.org/2000/svg",
};

/** A generic document/page glyph. */
export function PageIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M4 1.75h4.5L12 5.25V14a.75.75 0 0 1-.75.75h-7A.75.75 0 0 1 3.5 14V2.5a.75.75 0 0 1 .5-.75Z" />
      <path d="M8.5 1.75V5.25H12" />
    </svg>
  );
}

/** A home glyph used for the wiki root page. */
export function HomeIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M2.5 7.5 8 3l5.5 4.5" />
      <path d="M3.75 6.75V13a.5.5 0 0 0 .5.5h7.5a.5.5 0 0 0 .5-.5V6.75" />
    </svg>
  );
}

/** A chevron used as the expand/collapse affordance for tree rows. */
export function ChevronIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

/** A vertical ellipsis used to open a row's context menu. */
export function MoreIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className} strokeWidth={0} fill="currentColor">
      <circle cx="8" cy="3.5" r="1.35" />
      <circle cx="8" cy="8" r="1.35" />
      <circle cx="8" cy="12.5" r="1.35" />
    </svg>
  );
}

/** A plus glyph for the "new page" / "add sub-page" affordances. */
export function PlusIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

/** A panel-collapse glyph (points the sidebar toward the left edge). */
export function CollapsePanelIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <path d="M6 2.5v11" />
      <path d="M11 6l-2 2 2 2" />
    </svg>
  );
}

/** A panel-expand glyph (points the sidebar toward the right). */
export function ExpandPanelIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <path d="M6 2.5v11" />
      <path d="M9 6l2 2-2 2" />
    </svg>
  );
}

/** A speech-bubble glyph used for the comments affordance. */
export function CommentIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M2.5 3.75h11a.75.75 0 0 1 .75.75v6a.75.75 0 0 1-.75.75H6l-3 2.25V11.25H2.5a.75.75 0 0 1-.75-.75v-6a.75.75 0 0 1 .75-.75Z" />
    </svg>
  );
}

/** A waste-bin glyph, used for destructive actions such as unlinking a page. */
export function TrashIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M2.75 4.25h10.5" />
      <path d="M6.25 4.25V2.75a.5.5 0 0 1 .5-.5h2.5a.5.5 0 0 1 .5.5v1.5" />
      <path d="M4.25 4.25l.6 8.4a.75.75 0 0 0 .75.6h4.8a.75.75 0 0 0 .75-.6l.6-8.4" />
      <path d="M6.75 6.75v4M9.25 6.75v4" />
    </svg>
  );
}

/** A close (X) glyph. */
export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
