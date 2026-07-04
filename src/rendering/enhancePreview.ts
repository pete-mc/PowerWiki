// DOM post-processing applied to the rendered Markdown preview: syntax
// highlighting (highlight.js is loaded as its own async chunk the first time a
// code block is shown) and a copy button on each code block. Both are
// idempotent so they can run again after re-renders without duplicating work.

type HljsApi = (typeof import("highlight.js"))["default"];

let hljsPromise: Promise<HljsApi> | undefined;

function loadHljs(): Promise<HljsApi> {
  hljsPromise ??= import("highlight.js").then((module) => module.default);
  return hljsPromise;
}

/** Syntax-highlights fenced code blocks (Mermaid <pre> blocks have no <code>). */
export async function highlightCodeBlocks(container: HTMLElement): Promise<void> {
  const blocks = Array.from(container.querySelectorAll<HTMLElement>("pre > code:not([data-highlighted])"));
  if (blocks.length === 0) {
    return;
  }

  const hljs = await loadHljs();
  for (const code of blocks) {
    if (code.dataset.highlighted) {
      continue;
    }
    try {
      hljs.highlightElement(code);
    } catch {
      code.dataset.highlighted = "yes";
    }
  }
}

/** Adds a "Copy" button to each code block (skips Mermaid diagrams). */
export function addCopyButtons(container: HTMLElement): void {
  for (const pre of Array.from(container.querySelectorAll<HTMLElement>("pre"))) {
    if (
      pre.classList.contains("mermaid") ||
      pre.classList.contains("mermaid-rendered") ||
      pre.classList.contains("mermaid-error") ||
      !pre.querySelector("code") ||
      pre.querySelector(".powerwiki-copy-code")
    ) {
      continue;
    }

    pre.classList.add("powerwiki-code-block");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "powerwiki-copy-code";
    button.setAttribute("aria-label", "Copy code");
    button.textContent = "Copy";
    pre.appendChild(button);
  }
}
