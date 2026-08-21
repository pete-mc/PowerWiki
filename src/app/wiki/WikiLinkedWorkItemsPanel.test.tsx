import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { LinkedWorkItem } from "../../workItems/LinkedWorkItem";
import { WikiLinkedWorkItemsPanel } from "./WikiLinkedWorkItemsPanel";

const ITEMS: readonly LinkedWorkItem[] = [
  { id: 601, title: "Mermaid gallery is out of date", type: "Issue", state: "Active",
    stateCategory: "InProgress", assignedToName: "Ada" },
  { id: 42, title: "Add a diagram", type: "Task", state: "Done", stateCategory: "Completed" }
];

let container: HTMLDivElement | undefined;
let root: Root | undefined;

function render(props: Partial<Parameters<typeof WikiLinkedWorkItemsPanel>[0]> = {}): HTMLDivElement {
  container = document.createElement("div");
  root = createRoot(container);
  act(() => {
    root!.render(
      <WikiLinkedWorkItemsPanel
        items={ITEMS}
        loading={false}
        onClose={() => {}}
        onOpen={() => {}}
        {...props}
      />
    );
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container = undefined;
});

describe("WikiLinkedWorkItemsPanel", () => {
  it("lists each linked work item with its id, state and title", () => {
    const element = render();
    const rows = [...element.querySelectorAll(".powerwiki-work-item")];

    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("601");
    expect(rows[0].textContent).toContain("Active");
    expect(rows[0].textContent).toContain("Mermaid gallery is out of date");
    expect(rows[0].textContent).toContain("Ada");
  });

  it("opens the clicked work item", () => {
    const opened: number[] = [];
    const element = render({ onOpen: (id) => opened.push(id) });

    act(() => {
      element.querySelectorAll<HTMLButtonElement>(".powerwiki-work-item")[1].click();
    });

    expect(opened).toEqual([42]);
  });

  it("renders the type icon the service supplied, and copes without one", () => {
    const icons = new Map([["Issue", '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1" /></svg>']]);
    const element = render({ icons });
    const rendered = element.querySelectorAll(".powerwiki-work-item-icon svg");

    expect(rendered).toHaveLength(1);
  });

  it("ignores markup that is not a well-formed SVG", () => {
    const icons = new Map([["Issue", "<script>alert(1)</script>"]]);
    const element = render({ icons });

    expect(element.querySelector(".powerwiki-work-item-icon script")).toBeNull();
    expect(element.querySelector(".powerwiki-work-item-icon")?.childNodes.length).toBe(0);
  });

  it("stands finished work down without hiding it", () => {
    const element = render();
    const rows = element.querySelectorAll(".powerwiki-work-item");

    expect(rows[0].className).not.toContain("closed");
    expect(rows[1].className).toContain("closed");
    expect(rows[1].textContent).toContain("Add a diagram");
  });

  it("treats an unresolved state category as open", () => {
    const element = render({ items: [{ id: 9, title: "No category", state: "Whatever" }] });

    expect(element.querySelector(".powerwiki-work-item")?.className).not.toContain("closed");
  });

  it("says so when nothing links to the page", () => {
    const element = render({ items: [] });

    expect(element.textContent).toContain("No work items link to this page");
  });

  it("shows a load failure rather than an empty list", () => {
    const element = render({ error: "Work items could not be read." });

    expect(element.querySelector('[role="alert"]')?.textContent).toContain("could not be read");
    expect(element.querySelector(".powerwiki-work-item")).toBeNull();
  });

  it("falls back to the id when a work item has no title", () => {
    const element = render({ items: [{ id: 7 }] });

    expect(element.querySelector(".powerwiki-work-item-title")?.textContent).toBe("Work item 7");
  });
});
