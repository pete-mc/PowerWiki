import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface MermaidZoomOverlayProps {
  /** Serialized SVG markup of the rendered diagram (trusted — mermaid output). */
  readonly svgHtml: string;
  readonly onClose: () => void;
}

const clampScale = (value: number) => Math.min(8, Math.max(0.25, value));

/** Fullscreen pan/zoom viewer for a rendered Mermaid diagram. */
export function MermaidZoomOverlay({ svgHtml, onClose }: MermaidZoomOverlayProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Open at a scale that fills the stage rather than the diagram's small
  // in-article size (mermaid caps the SVG width to the content column, so at
  // scale 1 the fullscreen overlay showed a tiny diagram surrounded by space).
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const svg = stage?.querySelector("svg");
    if (!stage || !svg) {
      return;
    }

    const svgRect = svg.getBoundingClientRect();
    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;
    if (!svgRect.width || !svgRect.height || !stageWidth || !stageHeight) {
      return;
    }

    const padding = 0.94;
    const fit = Math.min((stageWidth * padding) / svgRect.width, (stageHeight * padding) / svgRect.height);
    setScale(clampScale(fit));
    setOffset({ x: 0, y: 0 });
  }, [svgHtml]);

  return (
    <div className="powerwiki-mermaid-zoom" role="dialog" aria-modal="true">
      <div className="powerwiki-mermaid-zoom-bar">
        <button aria-label="Zoom in" onClick={() => setScale((s) => clampScale(s * 1.2))} type="button">+</button>
        <button aria-label="Zoom out" onClick={() => setScale((s) => clampScale(s / 1.2))} type="button">&minus;</button>
        <button
          onClick={() => {
            setScale(1);
            setOffset({ x: 0, y: 0 });
          }}
          type="button"
        >
          Reset
        </button>
        <button aria-label="Close" onClick={onClose} type="button">&times;</button>
      </div>
      <div
        className="powerwiki-mermaid-zoom-stage"
        ref={stageRef}
        onPointerDown={(event) => {
          dragStart.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerLeave={() => {
          dragStart.current = null;
        }}
        onPointerMove={(event) => {
          if (dragStart.current) {
            setOffset({ x: event.clientX - dragStart.current.x, y: event.clientY - dragStart.current.y });
          }
        }}
        onPointerUp={() => {
          dragStart.current = null;
        }}
        onWheel={(event) => {
          setScale((s) => clampScale(s * (event.deltaY < 0 ? 1.1 : 0.9)));
        }}
      >
        <div
          className="powerwiki-mermaid-zoom-content"
          dangerouslySetInnerHTML={{ __html: svgHtml }}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
        />
      </div>
    </div>
  );
}
