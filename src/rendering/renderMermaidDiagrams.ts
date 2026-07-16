// Mermaid is large (the biggest slice of the main bundle), so it's loaded as a
// separate async chunk the first time a diagram actually needs rendering, rather
// than up front on every hub load. The chunk is fetched from the extension's own
// CDN dist/ path via webpack's "auto" publicPath.
type MermaidApi = (typeof import("mermaid"))["default"];

let mermaidPromise: Promise<MermaidApi> | undefined;
let currentTheme: string | null = null;
let diagramId = 0;

function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import("mermaid").then((module) => module.default);
  return mermaidPromise;
}

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
    const mermaid = await loadMermaid();
    const theme = resolveTheme(mode);
    ensureMermaidInitialized(mermaid, theme);

    for (const node of nodes) {
      await renderMermaidNode(mermaid, node);
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

function ensureMermaidInitialized(mermaid: MermaidApi, theme: string): void {
  if (currentTheme === theme) {
    return;
  }

  mermaid.initialize({
    logLevel: "error",
    securityLevel: "strict",
    startOnLoad: false,
    // While a diagram is being edited its source is briefly invalid on almost
    // every keystroke. Left to its own devices Mermaid renders a big "Syntax
    // error" bomb graphic into a temporary node on document.body (which it then
    // fails to clean up, so it lands below the editor and shoves the layout).
    // Suppress it and let renderMermaidNode show a small inline message instead.
    suppressErrorRendering: true,
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

async function renderMermaidNode(mermaid: MermaidApi, node: HTMLElement): Promise<void> {
  const source = node.textContent?.trim() ?? "";
  if (!source) {
    return;
  }

  node.setAttribute("data-processed", "true");

  // Validate the source before rendering. While a diagram is edited it is
  // briefly invalid on almost every keystroke; mermaid.render() would throw and
  // leave orphaned temp nodes on document.body (which shove the page/editor and
  // dump stray markup below the editor). mermaid.parse() with suppressErrors
  // returns false for bad input without touching the DOM, so we can show a small
  // inline message and skip render entirely.
  let parsed: unknown = false;
  try {
    parsed = await mermaid.parse(source, { suppressErrors: true });
  } catch {
    parsed = false;
  }
  if (!parsed) {
    renderMermaidError(node, new Error("The diagram source is not valid yet."));
    return;
  }

  const id = `powerwiki-mermaid-${++diagramId}`;
  try {
    const { svg, bindFunctions } = await mermaid.render(id, source);
    node.classList.remove("mermaid");
    node.classList.add("mermaid-rendered");
    node.innerHTML = svg;
    bindFunctions?.(node);
  } catch (error: unknown) {
    renderMermaidError(node, error);
  } finally {
    // mermaid.render renders into a temporary <div id="d{id}"> on document.body
    // that isn't always cleaned up, so nodes accumulate as the user edits.
    // Remove only that temp div — the rendered SVG has id="{id}" (no "d"
    // prefix) and lives inside our node, so it is never matched here.
    document.getElementById(`d${id}`)?.remove();
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
