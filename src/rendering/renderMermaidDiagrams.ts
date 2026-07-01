import mermaid from "mermaid";

let currentTheme: string | null = null;

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
export async function renderMermaidDiagrams(container: HTMLElement): Promise<void> {
  const theme = resolveTheme();
  ensureMermaidInitialized(theme);

  const nodes = container.querySelectorAll<HTMLElement>(
    "pre.mermaid:not([data-processed='true'])"
  );

  if (nodes.length === 0) {
    return;
  }

  try {
    await mermaid.run({ nodes, suppressErrors: true });
  } catch {
    // mermaid.run marks failing nodes with data-processed and inserts an
    // error <text> element into the SVG, so we don't need to do anything here.
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

