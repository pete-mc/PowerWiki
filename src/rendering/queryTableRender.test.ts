import { beforeEach, describe, expect, it } from "vitest";

import { renderQueryResult, type QueryTableResult, type QueryTableRow } from "./MarkdownPreview";

function row(id: number, values: Record<string, string>, children?: QueryTableRow[]): QueryTableRow {
  return { id, values: new Map(Object.entries(values)), children };
}

const COLUMNS = [
  { name: "ID", referenceName: "System.Id" },
  { name: "Title", referenceName: "System.Title" },
  { name: "Description", referenceName: "System.Description" },
];

describe("renderQueryResult", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("renders HTML columns as sanitized markup, not escaped text", () => {
    const result: QueryTableResult = {
      columns: COLUMNS,
      htmlColumns: new Set(["System.Description"]),
      rows: [row(1, { "System.Id": "1", "System.Title": "A", "System.Description": "<b>bold</b><script>evil()</script>" })],
    };

    renderQueryResult(container, result);

    const html = container.querySelector(".powerwiki-query-html");
    expect(html).not.toBeNull();
    expect(html?.querySelector("b")?.textContent).toBe("bold");
    expect(html?.querySelector("script")).toBeNull();
  });

  it("clips over-long plain text and keeps the full value in the title", () => {
    const long = "x".repeat(500);
    const result: QueryTableResult = {
      columns: COLUMNS,
      rows: [row(2, { "System.Id": "2", "System.Title": long, "System.Description": "" })],
    };

    renderQueryResult(container, result);

    const titleCell = container.querySelectorAll("tbody td")[1] as HTMLElement;
    expect(titleCell.textContent?.endsWith("…")).toBe(true);
    expect(titleCell.textContent?.length).toBeLessThan(long.length);
    expect(titleCell.title).toBe(long);
  });

  it("renders a tree with nested rows and a working expand/collapse toggle", () => {
    const result: QueryTableResult = {
      columns: COLUMNS,
      isTree: true,
      rows: [
        row(
          10,
          { "System.Id": "10", "System.Title": "Parent", "System.Description": "" },
          [row(11, { "System.Id": "11", "System.Title": "Child", "System.Description": "" })]
        ),
      ],
    };

    renderQueryResult(container, result);

    const rows = Array.from(container.querySelectorAll<HTMLElement>("tbody tr"));
    expect(rows).toHaveLength(2);
    expect(rows[0].dataset.depth).toBe("0");
    expect(rows[1].dataset.depth).toBe("1");

    const toggle = rows[0].querySelector<HTMLButtonElement>(".powerwiki-query-tree-toggle");
    expect(toggle).not.toBeNull();

    // The child is visible until the parent is collapsed.
    expect(rows[1].hidden).toBe(false);
    toggle?.click();
    expect(rows[1].hidden).toBe(true);
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    toggle?.click();
    expect(rows[1].hidden).toBe(false);
  });

  it("gives leaf rows a spacer instead of a toggle in tree mode", () => {
    const result: QueryTableResult = {
      columns: COLUMNS,
      isTree: true,
      rows: [row(20, { "System.Id": "20", "System.Title": "Leaf", "System.Description": "" })],
    };

    renderQueryResult(container, result);

    const firstRow = container.querySelector("tbody tr");
    expect(firstRow?.querySelector(".powerwiki-query-tree-toggle")).toBeNull();
    expect(firstRow?.querySelector(".powerwiki-query-tree-spacer")).not.toBeNull();
  });
});
