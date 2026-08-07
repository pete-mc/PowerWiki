// Hover affordance for draw.io diagrams in the rendered preview. A stored
// diagram is an ordinary <img> pointing at a ".drawio.png" attachment, so it
// needs no special rendering — only a way to reopen it in the editor. The button
// is added in the DOM (like the Mermaid toolbar) rather than in the Markdown, so
// the stored source stays portable.

import { isDrawioPath } from "../drawio/drawioDiagram";

/** Carries the diagram's wiki path (as written in the Markdown) to the click handler. */
export const DIAGRAM_SOURCE_ATTR = "data-powerwiki-diagram-src";

export const DIAGRAM_EDIT_SELECTOR = "[data-powerwiki-diagram-action='edit']";

/**
 * Wraps each draw.io image in a positioned container and adds an "Edit" button.
 * Idempotent: images already wrapped are skipped, so it can run again after any
 * re-render or enrichment pass.
 */
export function addDiagramTools(container: HTMLElement, imageSourceAttr: string): void {
  const images = Array.from(container.querySelectorAll<HTMLImageElement>(`img[${imageSourceAttr}]`));

  for (const image of images) {
    const source = image.getAttribute(imageSourceAttr);
    if (!source || !isDrawioPath(source) || image.parentElement?.dataset.powerwikiDiagram) {
      continue;
    }

    const wrapper = document.createElement("span");
    wrapper.className = "powerwiki-diagram";
    wrapper.dataset.powerwikiDiagram = "yes";
    image.replaceWith(wrapper);
    wrapper.appendChild(image);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "powerwiki-diagram-edit";
    button.setAttribute("data-powerwiki-diagram-action", "edit");
    button.setAttribute(DIAGRAM_SOURCE_ATTR, source);
    button.setAttribute("aria-label", "Edit diagram");
    button.title = "Edit this diagram in draw.io";
    button.textContent = "Edit diagram";
    wrapper.appendChild(button);
  }
}
