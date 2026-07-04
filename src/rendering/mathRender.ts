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

  // Claim each node and capture its raw TeX *synchronously*, before the await
  // below. The preview's layout effect can call renderMath again while the first
  // KaTeX import is still loading (e.g. an async subpage/enrichment result bumps
  // it); marking data-rendered up front means the concurrent call's
  // `:not([data-rendered])` query skips these nodes instead of re-reading the
  // half-rendered output as its input — which otherwise renders the equation
  // stacked on top of itself.
  const jobs = nodes.map((node) => {
    const tex = node.textContent ?? "";
    const displayMode = node.getAttribute(MATH_ATTR) === "display";
    node.dataset.rendered = "yes";
    return { node, tex, displayMode };
  });

  const katex = await loadKatex();
  for (const { node, tex, displayMode } of jobs) {
    try {
      katex.render(tex, node, { displayMode, throwOnError: false });
    } catch {
      // Leave the raw TeX in place if KaTeX can't parse it.
    }
  }
}
