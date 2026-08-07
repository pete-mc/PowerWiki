import { beforeEach, describe, expect, it, vi } from "vitest";

import { MERMAID_SOURCE_ATTR } from "./renderMermaidDiagrams";

const initialize = vi.fn();
const render = vi.fn(async (id: string, _source: string) => ({
  svg: `<svg id="${id}"><text>node</text></svg>`,
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: (config: unknown) => initialize(config),
    parse: async () => true,
    render: (id: string, source: string) => render(id, source),
  },
}));

// The module memoizes the loaded mermaid singleton and the config it last
// applied, so each test starts from a fresh copy of the module.
let renderMermaidDiagrams: typeof import("./renderMermaidDiagrams").renderMermaidDiagrams;

beforeEach(async () => {
  initialize.mockClear();
  render.mockClear();
  vi.resetModules();
  ({ renderMermaidDiagrams } = await import("./renderMermaidDiagrams"));
});

function containerWith(source: string): HTMLElement {
  const container = document.createElement("div");
  const pre = document.createElement("pre");
  pre.className = "mermaid";
  pre.textContent = source;
  container.appendChild(pre);
  return container;
}

describe("renderMermaidDiagrams", () => {
  it("renders a diagram into the node", async () => {
    const container = containerWith("flowchart LR\n A --> B");
    await renderMermaidDiagrams(container, "light");

    const node = container.querySelector("pre")!;
    expect(node.querySelector("svg")).not.toBeNull();
    expect(node.classList.contains("mermaid-rendered")).toBe(true);
  });

  it("keeps the diagram source on the node for exporters to fall back to", async () => {
    const container = containerWith("flowchart LR\n A --> B");
    await renderMermaidDiagrams(container, "light");

    expect(container.querySelector("pre")!.getAttribute(MERMAID_SOURCE_ATTR)).toBe("flowchart LR\n A --> B");
  });

  it("uses HTML labels by default", async () => {
    await renderMermaidDiagrams(containerWith("pie title Votes"), "light");
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ htmlLabels: true }));
  });

  // The Word export rasterizes the rendered SVG through a canvas, and an SVG
  // containing a <foreignObject> (what HTML labels produce) taints it — the
  // diagram then can't be embedded and the page loses it.
  it("renders plain-text labels when the caller asks for them", async () => {
    await renderMermaidDiagrams(containerWith("flowchart LR\n A --> B"), "light", { htmlLabels: false });
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ htmlLabels: false }));
  });

  it("re-initializes when only the label mode changes, not just the theme", async () => {
    await renderMermaidDiagrams(containerWith("flowchart LR\n A --> B"), "light", { htmlLabels: false });
    expect(initialize).toHaveBeenCalledTimes(1);

    // Same theme, different label mode: mermaid is a singleton, so skipping this
    // re-init would silently export diagrams with the previous caller's config.
    await renderMermaidDiagrams(containerWith("flowchart LR\n A --> B"), "light", { htmlLabels: true });
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(initialize).toHaveBeenLastCalledWith(expect.objectContaining({ htmlLabels: true }));
  });

  it("does not re-initialize for an unchanged theme and label mode", async () => {
    await renderMermaidDiagrams(containerWith("flowchart LR\n A --> B"), "dark", { htmlLabels: true });
    expect(initialize).toHaveBeenCalledTimes(1);

    await renderMermaidDiagrams(containerWith("flowchart LR\n A --> B"), "dark", { htmlLabels: true });
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("skips nodes that are already processed", async () => {
    const container = containerWith("flowchart LR\n A --> B");
    await renderMermaidDiagrams(container, "light");
    await renderMermaidDiagrams(container, "light");

    expect(render).toHaveBeenCalledTimes(1);
  });
});
