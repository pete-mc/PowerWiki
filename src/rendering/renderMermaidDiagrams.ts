import mermaid from "mermaid";

let currentTheme: string | null = null;
let diagramId = 0;

/**
 * Renders every unprocessed <pre class="mermaid"> block inside the container.
 *
 * This mirrors the approach used by VS Code's built-in markdown preview
 * (via the bierner.markdown-mermaid extension):
 *   1. markdown-it emits <pre class="mermaid">SOURCE</pre> for fenced blocks
 *   2. mermaid.run() reads .textContent of each node, generates the SVG, and
 *      mutates the node in place — no HTML-string round trip
 *   3. No post-render sanitization: mermaid's own securityLevel:"strict" runs
 *      DOMPurify internally on the diagram source. Passing the rendered SVG
 *      through DOMPurify again is what previously stripped the HTML content
 *      inside <foreignObject> node labels (DOMPurify's HTML parser doesn't
 *      correctly preserve SVG-to-HTML namespace transitions during
 *      string serialization).
 */
export async function renderMermaidDiagrams(
  container: HTMLElement,
  mode?: "dark" | "light"
): Promise<void> {
  normalizeMermaidCodeBlocks(container);

  const nodes = Array.from(container.querySelectorAll<HTMLElement>(
    "pre.mermaid:not([data-processed='true'])"
  ));

  if (nodes.length === 0) {
    return;
  }

  try {
    const theme = resolveTheme(mode);
    ensureMermaidInitialized(theme);

    for (const node of nodes) {
      await renderMermaidNode(node);
    }
  } catch (error: unknown) {
    for (const node of nodes) {
      renderMermaidError(node, error);
    }
  }
}

function resolveTheme(mode?: "dark" | "light"): string {
  // Prefer the explicit Azure DevOps theme mode passed by the caller; fall back
  // to the OS preference only when it isn't supplied.
  if (mode) {
    return mode === "dark" ? "dark" : "default";
  }

  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "default";
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

function normalizeMermaidCodeBlocks(container: HTMLElement): void {
  const codeBlocks = container.querySelectorAll<HTMLElement>(
    "pre > code.language-mermaid, pre > code.lang-mermaid"
  );

  for (const codeBlock of Array.from(codeBlocks)) {
    const pre = codeBlock.parentElement;
    if (!pre || pre.classList.contains("mermaid")) {
      continue;
    }

    pre.classList.add("mermaid");
    pre.textContent = codeBlock.textContent ?? "";
  }
}

async function renderMermaidNode(node: HTMLElement): Promise<void> {
  const source = node.textContent?.trim() ?? "";
  if (!source) {
    return;
  }

  node.setAttribute("data-processed", "true");

  try {
    const id = `powerwiki-mermaid-${++diagramId}`;
    const { svg, bindFunctions } = await mermaid.render(id, source);
    node.classList.remove("mermaid");
    node.classList.add("mermaid-rendered");
    node.innerHTML = svg;
    bindFunctions?.(node);
  } catch (error: unknown) {
    renderMermaidError(node, error);
  }
}

function renderMermaidError(node: HTMLElement, error: unknown): void {
  node.setAttribute("data-processed", "true");
  node.classList.remove("mermaid");
  node.classList.add("mermaid-error");
  node.textContent = formatMermaidError(error);
}

function formatMermaidError(error: unknown): string {
  if (error instanceof Error) {
    return `Unable to render Mermaid diagram: ${error.message}`;
  }

  return "Unable to render Mermaid diagram.";
}
