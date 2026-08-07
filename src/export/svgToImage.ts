// Rasterizes an in-DOM SVG (a rendered Mermaid diagram, or SVG the page author
// embedded directly) to a PNG for documents that cannot carry vector art, such
// as the Word export.
//
// The SVG must not contain a <foreignObject>: browsers treat drawing one onto a
// canvas as a cross-origin taint, so reading the pixels back out throws and the
// diagram cannot be embedded. Callers render Mermaid with `htmlLabels: false`
// (see renderMermaidDiagrams) to keep labels as SVG <text>.

export interface RasterImage {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

// Diagrams are drawn at 2x for crisp print output, bounded by what a canvas can
// actually allocate — browsers reject oversized canvases outright, which would
// otherwise turn a large diagram into a failed rasterization.
const RASTER_SCALE = 2;
const MAX_CANVAS_DIMENSION = 8192;
const MAX_CANVAS_PIXELS = 32_000_000;

/** Rasterizes an in-DOM SVG element to PNG, or null if it can't be rasterized. */
export function rasterizeSvgElement(svg: SVGElement): Promise<RasterImage | null> {
  return svgToPng(new XMLSerializer().serializeToString(svg));
}

function readSvgSize(svg: string): { width: number; height: number } {
  const viewBox = /viewBox="([\d.\s-]+)"/.exec(svg);
  if (viewBox) {
    const parts = viewBox[1].trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }
  return { width: 800, height: 600 };
}

/** Largest scale that keeps the canvas inside the browser's allocation limits. */
export function rasterScale(width: number, height: number): number {
  if (width <= 0 || height <= 0) {
    return RASTER_SCALE;
  }
  return Math.min(
    RASTER_SCALE,
    MAX_CANVAS_DIMENSION / width,
    MAX_CANVAS_DIMENSION / height,
    Math.sqrt(MAX_CANVAS_PIXELS / (width * height))
  );
}

function svgToPng(svg: string): Promise<RasterImage | null> {
  return new Promise((resolve) => {
    const fallback = readSvgSize(svg);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      const width = image.naturalWidth || fallback.width;
      const height = image.naturalHeight || fallback.height;
      try {
        const scale = rasterScale(width, height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          URL.revokeObjectURL(url);
          resolve(null);
          return;
        }
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((out) => {
          URL.revokeObjectURL(url);
          if (!out) {
            resolve(null);
            return;
          }
          out
            .arrayBuffer()
            .then((buffer) => resolve({ data: new Uint8Array(buffer), width, height }))
            .catch(() => resolve(null));
        }, "image/png");
      } catch {
        // Tainted canvas or other failure — skip this diagram.
        URL.revokeObjectURL(url);
        resolve(null);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}
