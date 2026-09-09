// Keeping the split view's two panes pointed at the same content.
//
// The editor knows a line number; the preview knows pixels. `sourceLinePlugin`
// stamps the rendered blocks with the line they came from, which turns the
// question into interpolation between the two nearest stamps.
//
// Anchors are read fresh on every sync rather than cached, which is what makes
// this survive the content that matters most: Mermaid diagrams, KaTeX and
// images all settle to their real height *after* the HTML lands, and a cached
// offset table would be quietly wrong from then on.

import { SOURCE_LINE_ATTR } from "../../rendering/sourceLinePlugin";

export interface SourceLineAnchor {
  /** 1-based source line. */
  readonly line: number;
  /** Pixels from the top of the scrolling container's content. */
  readonly top: number;
}

/** Reads the anchors currently rendered inside a preview container. */
export function readSourceLineAnchors(container: HTMLElement): SourceLineAnchor[] {
  const containerTop = container.getBoundingClientRect().top - container.scrollTop;
  const anchors: SourceLineAnchor[] = [];
  for (const element of container.querySelectorAll<HTMLElement>(`[${SOURCE_LINE_ATTR}]`)) {
    const line = Number(element.getAttribute(SOURCE_LINE_ATTR));
    if (!Number.isFinite(line)) {
      continue;
    }
    const top = element.getBoundingClientRect().top - containerTop;
    // Nested blocks can repeat a line; the outermost one wins because it is
    // seen first and its top is the one a reader perceives.
    if (anchors.length > 0 && anchors[anchors.length - 1].line === line) {
      continue;
    }
    anchors.push({ line, top });
  }
  return anchors;
}

/** Where the preview should scroll to put `line` at the top of its viewport. */
export function previewTopForLine(
  anchors: readonly SourceLineAnchor[],
  line: number
): number | undefined {
  if (anchors.length === 0) {
    return undefined;
  }
  const [before, after] = surrounding(anchors, (anchor) => anchor.line <= line);
  if (!after) {
    return before.top;
  }
  return interpolate(line, before.line, after.line, before.top, after.top);
}

/** The source line showing at the top of the preview's viewport. */
export function lineForPreviewTop(
  anchors: readonly SourceLineAnchor[],
  top: number
): number | undefined {
  if (anchors.length === 0) {
    return undefined;
  }
  const [before, after] = surrounding(anchors, (anchor) => anchor.top <= top);
  if (!after) {
    return before.line;
  }
  return interpolate(top, before.top, after.top, before.line, after.line);
}

/** The last anchor satisfying `isBefore`, and the first one that does not. */
function surrounding(
  anchors: readonly SourceLineAnchor[],
  isBefore: (anchor: SourceLineAnchor) => boolean
): [SourceLineAnchor, SourceLineAnchor | undefined] {
  let before = anchors[0];
  for (const anchor of anchors) {
    if (isBefore(anchor)) {
      before = anchor;
    } else {
      return [before, anchor];
    }
  }
  return [before, undefined];
}

function interpolate(at: number, fromA: number, toA: number, fromB: number, toB: number): number {
  const span = toA - fromA;
  const fraction = span > 0 ? (at - fromA) / span : 0;
  return fromB + fraction * (toB - fromB);
}
