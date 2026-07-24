import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from "react";

interface ZoomPanOverlayProps {
  /** The single element to display (an <svg> wrapper or an <img>). */
  readonly children: ReactNode;
  readonly onClose: () => void;
  /** Extra class on the root dialog, for feature-specific styling hooks. */
  readonly rootClassName?: string;
  /** Extra class on the transformed content wrapper. */
  readonly contentClassName?: string;
  /**
   * Caps the fit-to-stage scale used when the overlay opens. Diagrams upscale
   * freely to fill the stage; raster images pass 1 so they never open blurrier
   * than their natural size.
   */
  readonly maxInitialScale?: number;
}

const clampScale = (value: number) => Math.min(8, Math.max(0.25, value));

/** Fullscreen pan/zoom viewer for a single piece of content (SVG or image). */
export function ZoomPanOverlay({
  children,
  onClose,
  rootClassName,
  contentClassName,
  maxInitialScale
}: ZoomPanOverlayProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Open at a scale that fills the stage: content is usually capped to the
  // content column at its in-article size, so at scale 1 the overlay would show
  // it tiny amid empty space. Measure the intrinsic <svg>/<img>, not a wrapper.
  const fitToStage = useCallback(() => {
    const stage = stageRef.current;
    const element = contentRef.current?.querySelector<HTMLElement>("svg, img");
    if (!stage || !element) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;
    if (!rect.width || !rect.height || !stageWidth || !stageHeight) {
      return;
    }

    const padding = 0.94;
    let fit = Math.min((stageWidth * padding) / rect.width, (stageHeight * padding) / rect.height);
    if (maxInitialScale !== undefined) {
      fit = Math.min(fit, maxInitialScale);
    }
    setScale(clampScale(fit));
    setOffset({ x: 0, y: 0 });
  }, [maxInitialScale]);

  useLayoutEffect(() => {
    fitToStage();
    // An image may not have loaded yet (zero size); refit once it does.
    const image = contentRef.current?.querySelector("img");
    if (image && !image.complete) {
      const onLoad = () => fitToStage();
      image.addEventListener("load", onLoad);
      return () => image.removeEventListener("load", onLoad);
    }
    return undefined;
  }, [fitToStage]);

  return (
    <div
      className={rootClassName ? `powerwiki-zoom ${rootClassName}` : "powerwiki-zoom"}
      role="dialog"
      aria-modal="true"
    >
      <div className="powerwiki-zoom-bar">
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
        className="powerwiki-zoom-stage"
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
          className={contentClassName ? `powerwiki-zoom-content ${contentClassName}` : "powerwiki-zoom-content"}
          ref={contentRef}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
