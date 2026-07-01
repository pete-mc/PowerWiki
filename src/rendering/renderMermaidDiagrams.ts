import mermaid from "mermaid";

import { sanitizeRenderedSvg } from "./sanitizeRenderedHtml";

let currentTheme: string | null = null;

export async function renderMermaidDiagrams(container: HTMLElement): Promise<void> {
  const theme = resolveTheme();
  ensureMermaidInitialized(theme);

  const diagramBlocks = getMermaidDiagramBlocks(container);

  for (const [index, block] of diagramBlocks.entries()) {
    await renderMermaidDiagram(block, index);
  }
}

function getMermaidDiagramBlocks(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("pre > code.language-mermaid, div.mermaid")
  );
}

async function renderMermaidDiagram(element: HTMLElement, index: number): Promise<void> {
  const source = element.textContent ?? "";
  const renderTarget = element.matches("code") ? element.parentElement : element;

  if (!source.trim() || !renderTarget) {
    return;
  }

  try {
    const diagramId = `powerwiki-mermaid-${index}-${hashDiagramSource(source)}`;
    const rendered = await mermaid.render(diagramId, source);

    renderTarget.className = "mermaid-rendered";
    renderTarget.innerHTML = sanitizeRenderedSvg(rendered.svg);
    rendered.bindFunctions?.(renderTarget);
  } catch (error: unknown) {
    renderTarget.className = "mermaid-error";
    renderTarget.textContent = formatMermaidError(error);
  }
}

function resolveTheme(): string {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default";
}

function ensureMermaidInitialized(theme: string): void {
  if (currentTheme === theme) {
    return;
  }

  mermaid.initialize({
    logLevel: "error",
    securityLevel: "strict",
    startOnLoad: false,
    theme: theme as Parameters<typeof mermaid.initialize>[0]["theme"],
  });
  currentTheme = theme;
}

function hashDiagramSource(source: string): string {
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash << 5) - hash + source.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

function formatMermaidError(error: unknown): string {
  if (error instanceof Error) {
    return `Unable to render Mermaid diagram: ${error.message}`;
  }

  return "Unable to render Mermaid diagram.";
}
