// Hover toolbar (zoom / download) for rendered Mermaid diagrams, plus SVG/PNG
// export helpers. The zoom action is handled by MarkdownPreview (it opens a
// pan/zoom overlay); download actions are handled here.

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
      '<button type="button" data-mermaid-action="svg" aria-label="Download as SVG" title="Download SVG">SVG</button>' +
      '<button type="button" data-mermaid-action="png" aria-label="Download as PNG" title="Download PNG">PNG</button>';
    node.appendChild(toolbar);
  }
}

export function downloadMermaidSvg(svg: SVGElement): void {
  const blob = new Blob([serialize(svg)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, "diagram.svg");
  URL.revokeObjectURL(url);
}

/**
 * Best-effort PNG export. Diagrams whose labels use <foreignObject> can taint
 * the canvas (a browser security restriction); in that case the export is
 * skipped silently and the SVG download remains available.
 */
export function downloadMermaidPng(svg: SVGElement): void {
  const rect = svg.getBoundingClientRect();
  const svgUrl = URL.createObjectURL(new Blob([serialize(svg)], { type: "image/svg+xml;charset=utf-8" }));
  const image = new Image();

  image.onload = () => {
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((rect.width || image.width) * scale));
    canvas.height = Math.max(1, Math.round((rect.height || image.height) * scale));
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      try {
        canvas.toBlob((blob) => {
          if (blob) {
            const pngUrl = URL.createObjectURL(blob);
            triggerDownload(pngUrl, "diagram.png");
            URL.revokeObjectURL(pngUrl);
          }
        });
      } catch {
        // Tainted canvas (foreignObject labels) — skip; SVG export still works.
      }
    }
    URL.revokeObjectURL(svgUrl);
  };
  image.onerror = () => URL.revokeObjectURL(svgUrl);
  image.src = svgUrl;
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
