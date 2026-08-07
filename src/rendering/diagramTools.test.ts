// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { addDiagramTools, DIAGRAM_SOURCE_ATTR } from "./diagramTools";

const SOURCE_ATTR = "data-powerwiki-image-src";

function container(html: string): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element;
}

function image(src: string): string {
  return `<p><img ${SOURCE_ATTR}="${src}" alt="d"></p>`;
}

describe("addDiagramTools", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("adds an edit button carrying the diagram's authored path", () => {
    const path = "/.attachments/architecture-lk9f2abc1234.drawio.png";
    const element = container(image(path));

    addDiagramTools(element, SOURCE_ATTR);

    const button = element.querySelector<HTMLElement>(".powerwiki-diagram-edit");
    expect(button).not.toBeNull();
    expect(button?.getAttribute(DIAGRAM_SOURCE_ATTR)).toBe(path);
    // The image is wrapped so the button can be positioned over it.
    expect(element.querySelector(".powerwiki-diagram img")).not.toBeNull();
  });

  it("leaves ordinary images alone", () => {
    const element = container(image("/.attachments/screenshot.png"));

    addDiagramTools(element, SOURCE_ATTR);

    expect(element.querySelector(".powerwiki-diagram-edit")).toBeNull();
    expect(element.querySelector(".powerwiki-diagram")).toBeNull();
  });

  it("is idempotent across repeated enrichment passes", () => {
    const element = container(image("/.attachments/flow-abcdefgh1234.drawio.png"));

    addDiagramTools(element, SOURCE_ATTR);
    addDiagramTools(element, SOURCE_ATTR);
    addDiagramTools(element, SOURCE_ATTR);

    expect(element.querySelectorAll(".powerwiki-diagram-edit")).toHaveLength(1);
    expect(element.querySelectorAll(".powerwiki-diagram")).toHaveLength(1);
    expect(element.querySelectorAll("img")).toHaveLength(1);
  });

  it("handles several diagrams and a mix of image types on one page", () => {
    const element = container(
      image("/.attachments/one-aaaaaaaa1111.drawio.png") +
        image("/.attachments/photo.png") +
        image("/.attachments/two-bbbbbbbb2222.drawio.png")
    );

    addDiagramTools(element, SOURCE_ATTR);

    const buttons = Array.from(
      element.querySelectorAll<HTMLElement>(".powerwiki-diagram-edit")
    ).map((button) => button.getAttribute(DIAGRAM_SOURCE_ATTR));
    expect(buttons).toEqual([
      "/.attachments/one-aaaaaaaa1111.drawio.png",
      "/.attachments/two-bbbbbbbb2222.drawio.png",
    ]);
  });

  it("ignores images that have not been resolved to an attachment", () => {
    const element = container('<p><img src="https://example.com/x.drawio.png"></p>');

    addDiagramTools(element, SOURCE_ATTR);

    expect(element.querySelector(".powerwiki-diagram-edit")).toBeNull();
  });
});
