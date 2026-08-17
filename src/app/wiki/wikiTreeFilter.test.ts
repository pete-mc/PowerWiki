import { describe, expect, it } from "vitest";

import type { WikiPageTreeNode } from "../../wiki/WikiPageTree";
import { countWikiPageTreeNodes, filterWikiPageTree } from "./wikiTreeFilter";

function node(name: string, children: WikiPageTreeNode[] = []): WikiPageTreeNode {
  return {
    children,
    childrenLoaded: children.length > 0,
    hasChildren: children.length > 0,
    name,
    order: 0,
    path: `/${name}`
  };
}

const tree: WikiPageTreeNode[] = [
  node("Home"),
  node("Guides", [node("Mermaid Diagrams"), node("Exporting")]),
  node("Reference", [node("API"), node("Mermaid Syntax", [node("Flowcharts")])])
];

describe("filterWikiPageTree", () => {
  it("returns the tree unchanged for an empty query", () => {
    expect(filterWikiPageTree(tree, "  ")).toHaveLength(3);
  });

  it("keeps matching pages and drops the rest", () => {
    const filtered = filterWikiPageTree(tree, "exporting");
    expect(filtered.map((n) => n.name)).toEqual(["Guides"]);
    expect(filtered[0].children.map((n) => n.name)).toEqual(["Exporting"]);
  });

  // Losing the ancestors would leave a flat list with no sense of where a page
  // lives, which is the main thing a tree is for.
  it("keeps ancestors of a deep match", () => {
    const filtered = filterWikiPageTree(tree, "flowcharts");
    expect(filtered.map((n) => n.name)).toEqual(["Reference"]);
    expect(filtered[0].children.map((n) => n.name)).toEqual(["Mermaid Syntax"]);
    expect(filtered[0].children[0].children.map((n) => n.name)).toEqual(["Flowcharts"]);
  });

  it("matches case-insensitively across branches", () => {
    const filtered = filterWikiPageTree(tree, "MERMAID");
    expect(filtered.map((n) => n.name)).toEqual(["Guides", "Reference"]);
  });

  it("matches on the page name only, never the path", () => {
    // "Guides" appears in the path of its children but not in their names.
    const filtered = filterWikiPageTree(tree, "guides");
    expect(filtered[0].children).toEqual([]);
  });

  // An expander that would load children the filter then hides reads as a bug.
  it("marks surviving nodes as loaded with only the surviving children", () => {
    const filtered = filterWikiPageTree(tree, "api");
    expect(filtered[0].childrenLoaded).toBe(true);
    expect(filtered[0].hasChildren).toBe(true);
    expect(filtered[0].children[0].hasChildren).toBe(false);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterWikiPageTree(tree, "nonexistent")).toEqual([]);
  });
});

describe("countWikiPageTreeNodes", () => {
  it("counts every node in the tree", () => {
    expect(countWikiPageTreeNodes(tree)).toBe(8);
  });

  it("counts what survived a filter", () => {
    expect(countWikiPageTreeNodes(filterWikiPageTree(tree, "mermaid"))).toBe(4);
  });
});
