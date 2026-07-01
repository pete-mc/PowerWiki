import mermaid from "mermaid";

let mermaidInitialized = false;

export async function renderMermaidDiagrams(container: HTMLElement): Promise<void> {
  initializeMermaid();

  const diagramBlocks = Array.from(
    container.querySelectorAll<HTMLElement>("pre > code.language-mermaid")
  );

  await Promise.all(
    diagramBlocks.map(async (codeElement, index) => {
      const source = codeElement.textContent ?? "";
      const preElement = codeElement.parentElement;

      if (!source.trim() || !preElement) {
        return;
      }

      const diagramId = `powerwiki-mermaid-${index}-${hashDiagramSource(source)}`;
      const rendered = await mermaid.render(diagramId, source);

      preElement.className = "mermaid-rendered";
      preElement.innerHTML = rendered.svg;
    })
  );
}

function initializeMermaid(): void {
  if (mermaidInitialized) {
    return;
  }

  mermaid.initialize({
    securityLevel: "strict",
    startOnLoad: false,
    theme: "default"
  });
  mermaidInitialized = true;
}

function hashDiagramSource(source: string): string {
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash << 5) - hash + source.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

