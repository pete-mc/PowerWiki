// Keeps the split view's editor and preview looking at the same content.
//
// Two rules shape this:
//
//   * **Nothing here sets React state.** Scroll events fire many times a
//     second, and the preview re-renders Markdown on every change; driving that
//     from state would make scrolling stutter on exactly the pages worth
//     scrolling. Both directions read and write the DOM directly, through refs.
//   * **Whoever the user is scrolling wins.** Scrolling one pane moves the
//     other, whose scroll event would move the first one back - a feedback loop
//     that reads as jitter or a fight for the scrollbar. The pane that moved
//     last claims the sync for a moment, and the other's events are ignored
//     until it lapses.

import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from "react";

import { lineForPreviewTop, previewTopForLine, readSourceLineAnchors } from "./scrollSync";
import type { WikiEditorScrollControl } from "./WikiPageEditor";

/**
 * How long the pane being scrolled keeps control. Long enough to cover the
 * echo of the scroll it just caused (including a smooth-scrolled one), short
 * enough that taking hold of the other pane feels immediate.
 */
const DRIVER_HOLD_MS = 150;

export interface SplitScrollSync {
  /** Attach to the preview's scrolling container. */
  readonly previewRef: RefObject<HTMLDivElement | null>;
  /** Hand to WikiPageEditor as `scrollControlRef`. */
  readonly editorControlRef: MutableRefObject<WikiEditorScrollControl | undefined>;
  /** Hand to WikiPageEditor as `onTopLineChange`. */
  readonly onEditorTopLineChange: (line: number) => void;
}

export function useSplitScrollSync(active: boolean): SplitScrollSync {
  const previewRef = useRef<HTMLDivElement>(null);
  const editorControlRef = useRef<WikiEditorScrollControl | undefined>(undefined);
  const driverRef = useRef<{ pane: "editor" | "preview"; at: number } | undefined>(undefined);

  /** True when the other pane moved recently enough that this is its echo. */
  const isEcho = useCallback((pane: "editor" | "preview") => {
    const driver = driverRef.current;
    return (
      driver !== undefined && driver.pane !== pane && performance.now() - driver.at < DRIVER_HOLD_MS
    );
  }, []);

  const onEditorTopLineChange = useCallback(
    (line: number) => {
      const preview = previewRef.current;
      if (!active || !preview || isEcho("editor")) {
        return;
      }
      // Anchors are read per event rather than cached: Mermaid, KaTeX and
      // images all settle to their real height after the HTML lands, and a
      // cached table would be silently wrong from that moment on.
      const top = previewTopForLine(readSourceLineAnchors(preview), line);
      if (top === undefined) {
        return;
      }
      driverRef.current = { pane: "editor", at: performance.now() };
      preview.scrollTop = top;
    },
    [active, isEcho]
  );

  useEffect(() => {
    const preview = previewRef.current;
    if (!active || !preview) {
      return;
    }

    const onScroll = () => {
      const control = editorControlRef.current;
      if (!control || isEcho("preview")) {
        return;
      }
      const line = lineForPreviewTop(readSourceLineAnchors(preview), preview.scrollTop);
      if (line === undefined) {
        return;
      }
      driverRef.current = { pane: "preview", at: performance.now() };
      control.scrollToLine(line);
    };

    preview.addEventListener("scroll", onScroll, { passive: true });
    return () => preview.removeEventListener("scroll", onScroll);
  }, [active, isEcho]);

  return { previewRef, editorControlRef, onEditorTopLineChange };
}
