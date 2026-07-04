// Hover toolbar (zoom / download) for rendered Mermaid diagrams, plus the SVG
// export helper. The zoom action is handled by MarkdownPreview (it opens a
// pan/zoom overlay); the SVG download is handled here.
//
// PNG export was removed: rasterizing the SVG via canvas taints the canvas
// whenever a diagram uses <foreignObject> labels (a browser security
// restriction), so it failed for most real diagrams. SVG download always works,
// and users can screenshot for a raster copy.

/** Adds a toolbar to each rendered Mermaid diagram that doesn't have one yet. */
export function addMermaidToolbars(container: HTMLElement): void {
  for (const node of Array.from(container.querySelectorAll<HTMLElement>("pre.mermaid-rendered"))) {
    if (node.dataset.tools || !node.querySelector("svg")) {
      continue;
    }
    node.dataset.tools = "yes";

    const toolbar = document.createElement("div");
    toolbar.className = "powerwiki-mermaid-tools";
    toolbar.innerHTML =
      '<button type="button" data-mermaid-action="zoom" aria-label="Zoom diagram" title="Zoom">⤢</button>' +
      '<button type="button" data-mermaid-action="svg" aria-label="Download as SVG" title="Download SVG">SVG</button>';
    node.appendChild(toolbar);
  }
}

export function downloadMermaidSvg(svg: SVGElement): void {
  const blob = new Blob([serialize(svg)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, "diagram.svg");
  URL.revokeObjectURL(url);
}

function serialize(svg: SVGElement): string {
  return new XMLSerializer().serializeToString(svg);
}

function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
