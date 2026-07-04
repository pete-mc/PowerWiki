import { afterEach, describe, expect, it, vi } from "vitest";

import { MATH_ATTR } from "./mathPlugin";

// A stand-in for KaTeX that mirrors the two behaviors that made the concurrency
// bug possible: render() clears the node and rebuilds it, and the resulting DOM
// carries the raw TeX in an <annotation> plus a "glyph" copy in both the MathML
// and HTML subtrees. That means a node's textContent *after* rendering is longer
// than its source TeX — so a second render that re-reads it stacks the equation
// on top of itself (the tripled `E=mc2E = mc^2E=mc2` seen in the browser).
function glyphs(tex: string): string {
  return tex.replace(/[\s^{}\\]/g, "");
}

const renderMock = vi.fn((tex: string, node: HTMLElement) => {
  node.textContent = "";
  const katex = document.createElement("span");
  katex.className = "katex";
  katex.innerHTML =
    `<span class="katex-mathml">${glyphs(tex)}` +
    `<annotation encoding="application/x-tex">${tex}</annotation></span>` +
    `<span class="katex-html">${glyphs(tex)}</span>`;
  node.appendChild(katex);
});

vi.mock("katex", () => ({ default: { render: renderMock } }));
vi.mock("katex/dist/katex.min.css", () => ({}));

// Imported after the mocks are registered so loadKatex() resolves to the mock.
const { renderMath } = await import("./mathRender");

function makeContainer(): HTMLElement {
  const container = document.createElement("div");
  const span = document.createElement("span");
  span.className = "powerwiki-math";
  span.setAttribute(MATH_ATTR, "inline");
  span.textContent = "E = mc^2";
  container.appendChild(span);
  return container;
}

function annotation(container: HTMLElement): string {
  return container.querySelector("annotation")?.textContent ?? "";
}

afterEach(() => {
  renderMock.mockClear();
});

describe("renderMath", () => {
  it("renders each placeholder exactly once", async () => {
    const container = makeContainer();
    await renderMath(container);

    expect(container.querySelectorAll(".katex")).toHaveLength(1);
    expect(annotation(container)).toBe("E = mc^2");
  });

  it("does not double-render when called concurrently (the layout-effect race)", async () => {
    const container = makeContainer();

    // Two overlapping calls, both started before the first KaTeX import resolves
    // — exactly what happens when an async enrichment result re-runs the preview
    // layout effect while KaTeX is still loading.
    await Promise.all([renderMath(container), renderMath(container)]);

    expect(container.querySelectorAll(".katex")).toHaveLength(1);
    // The annotation must still be the original TeX, not the rendered output fed
    // back through KaTeX a second time.
    expect(annotation(container)).toBe("E = mc^2");
    expect(renderMock).toHaveBeenCalledTimes(1);
  });

  it("is idempotent across sequential re-runs", async () => {
    const container = makeContainer();
    await renderMath(container);
    await renderMath(container);

    expect(container.querySelectorAll(".katex")).toHaveLength(1);
    expect(annotation(container)).toBe("E = mc^2");
    expect(renderMock).toHaveBeenCalledTimes(1);
  });
});
