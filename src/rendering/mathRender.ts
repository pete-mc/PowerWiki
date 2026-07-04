import { MATH_ATTR } from "./mathPlugin";

// KaTeX (and its CSS/fonts) load as their own async chunk the first time a page
// actually contains math, keeping them out of the initial hub bundle.
type KatexApi = (typeof import("katex"))["default"];

let katexPromise: Promise<KatexApi> | undefined;

function loadKatex(): Promise<KatexApi> {
  katexPromise ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
    ([module]) => module.default
  );
  return katexPromise;
}

/** Renders every math placeholder in the container with KaTeX (idempotent). */
export async function renderMath(container: HTMLElement): Promise<void> {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(`[${MATH_ATTR}]:not([data-rendered])`));
  if (nodes.length === 0) {
    return;
  }

  const katex = await loadKatex();
  for (const node of nodes) {
    const tex = node.textContent ?? "";
    node.dataset.rendered = "yes";
    try {
      katex.render(tex, node, {
        displayMode: node.getAttribute(MATH_ATTR) === "display",
        throwOnError: false,
      });
    } catch {
      // Leave the raw TeX in place if KaTeX can't parse it.
    }
  }
}
