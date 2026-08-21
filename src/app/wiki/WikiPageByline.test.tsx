import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { WikiPageByline, type WikiPageBylineProps } from "./WikiPageByline";

let container: HTMLDivElement | undefined;
let root: Root | undefined;

function render(props: WikiPageBylineProps): HTMLDivElement {
  container = document.createElement("div");
  root = createRoot(container);
  act(() => {
    root!.render(<WikiPageByline {...props} />);
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container = undefined;
});

describe("WikiPageByline linked work items", () => {
  it("omits the bubble where the host cannot answer what links to a page", () => {
    const element = render({ commentCount: 2, commentsOpen: false, onToggleComments: () => {} });

    expect(element.querySelectorAll("button")).toHaveLength(1);
    expect(element.textContent).not.toContain("Linked work items");
  });

  it("shows the count beside comments once the host can", () => {
    const element = render({
      commentCount: 2,
      commentsOpen: false,
      onToggleComments: () => {},
      linkedWorkItemCount: 4,
      linkedWorkItemsOpen: false,
      onToggleLinkedWorkItems: () => {},
    });
    const bubble = element.querySelectorAll("button")[1];

    expect(bubble.textContent).toContain("Linked work items");
    expect(bubble.querySelector(".wiki-byline-comment-count")?.textContent).toBe("4");
    expect(bubble.getAttribute("aria-label")).toBe("Show linked work items");
  });

  it("shows zero rather than nothing while a page has no links", () => {
    const element = render({ linkedWorkItemsOpen: false, onToggleLinkedWorkItems: () => {} });

    expect(element.querySelector(".wiki-byline-comment-count")?.textContent).toBe("0");
  });

  it("reflects the open panel in its pressed state and label", () => {
    const element = render({
      linkedWorkItemCount: 1,
      linkedWorkItemsOpen: true,
      onToggleLinkedWorkItems: () => {},
    });
    const bubble = element.querySelector("button")!;

    expect(bubble.className).toContain("active");
    expect(bubble.getAttribute("aria-pressed")).toBe("true");
    expect(bubble.getAttribute("aria-label")).toBe("Hide linked work items");
  });

  it("toggles when clicked", () => {
    let clicks = 0;
    const element = render({ linkedWorkItemsOpen: false, onToggleLinkedWorkItems: () => { clicks += 1; } });

    act(() => element.querySelector("button")!.click());

    expect(clicks).toBe(1);
  });
});
