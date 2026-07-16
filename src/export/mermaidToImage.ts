// Renders a Mermaid diagram to a PNG raster for embedding in exported
// documents (Word/PDF). HTML labels are disabled so labels render as SVG
// <text> rather than <foreignObject>, which would otherwise taint the canvas
// and block rasterization.

export interface RasterImage {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

let initialized = false;

async function loadMermaid() {
  const mermaid = (await import("mermaid")).default;
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "neutral",
      securityLevel: "strict",
      flowchart: { htmlLabels: false },
      // Don't inject Mermaid's "Syntax error" bomb graphic into the DOM on a
      // bad diagram; mermaidToPng catches the throw and skips the diagram.
      suppressErrorRendering: true,
    });
    initialized = true;
  }
  return mermaid;
}

/** Renders Mermaid source to a PNG, or null if it can't be rendered/rasterized. */
export async function mermaidToPng(code: string, index: number): Promise<RasterImage | null> {
  try {
    const mermaid = await loadMermaid();
    const { svg } = await mermaid.render(`pw-export-mermaid-${index}-${Date.now()}`, code);
    return await svgToPng(svg);
  } catch {
    return null;
  }
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

/** Rasterizes an in-DOM SVG element (e.g. a rendered Mermaid diagram) to PNG. */
export function rasterizeSvgElement(svg: SVGElement): Promise<RasterImage | null> {
  return svgToPng(new XMLSerializer().serializeToString(svg));
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
        const scale = 2; // render at 2x for crisp print output
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
