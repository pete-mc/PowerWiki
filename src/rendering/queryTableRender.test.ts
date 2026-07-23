import { beforeEach, describe, expect, it } from "vitest";

import { renderQueryResult, type QueryTableResult, type QueryTableRow } from "./MarkdownPreview";
import { WORK_ITEM_ATTR } from "./adoWorkItemsPlugin";

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

  it("flattens HTML fields to plain text, dropping tags and script source", () => {
    const result: QueryTableResult = {
      columns: COLUMNS,
      htmlColumns: new Set(["System.Description"]),
      rows: [
        row(1, {
          "System.Id": "1",
          "System.Title": "A",
          "System.Description": "<p>hello <b>world</b></p><script>evil()</script>",
        }),
      ],
    };

    renderQueryResult(container, result);

    const descCell = container.querySelectorAll("tbody td")[2] as HTMLElement;
    expect(descCell.textContent).toBe("hello world");
    expect(descCell.querySelector("b")).toBeNull();
    expect(descCell.querySelector("script")).toBeNull();
  });

  it("clips text past 500 chars and keeps the full value in the title", () => {
    const long = "x".repeat(700);
    const result: QueryTableResult = {
      columns: COLUMNS,
      htmlColumns: new Set(["System.Description"]),
      rows: [row(2, { "System.Id": "2", "System.Title": "A", "System.Description": long })],
    };

    renderQueryResult(container, result);

    const descCell = container.querySelectorAll("tbody td")[2] as HTMLElement;
    expect(descCell.textContent?.endsWith("…")).toBe(true);
    expect(descCell.textContent?.length).toBe(501);
    expect(descCell.title).toBe(long);
  });

  it("renders the title as a work-item link with the type icon", () => {
    const result: QueryTableResult = {
      columns: COLUMNS,
      icons: new Map([["Bug", "<svg viewBox='0 0 16 16'><circle cx='8' cy='8' r='8'/></svg>"]]),
      rows: [
        row(7, {
          "System.Id": "7",
          "System.Title": "Fix the thing",
          "System.Description": "",
          "System.WorkItemType": "Bug",
        }),
      ],
    };

    renderQueryResult(container, result);

    const titleCell = container.querySelectorAll("tbody td")[1] as HTMLElement;
    const link = titleCell.querySelector<HTMLAnchorElement>("a.powerwiki-query-title-link");
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe("Fix the thing");
    expect(link?.getAttribute(WORK_ITEM_ATTR)).toBe("7");
    expect(titleCell.querySelector(".powerwiki-query-wit-icon svg")).not.toBeNull();
  });

  it("starts a tree collapsed and toggles children into view", () => {
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
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");

    // Collapsed by default: the child starts hidden and expands on click.
    expect(rows[1].hidden).toBe(true);
    toggle?.click();
    expect(rows[1].hidden).toBe(false);
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    toggle?.click();
    expect(rows[1].hidden).toBe(true);
  });

  it("renders the full tree expanded when initiallyCollapsed is false", () => {
    const result: QueryTableResult = {
      columns: COLUMNS,
      isTree: true,
      rows: [
        row(
          20,
          { "System.Id": "20", "System.Title": "Parent", "System.Description": "" },
          [row(21, { "System.Id": "21", "System.Title": "Child", "System.Description": "" })]
        ),
      ],
    };

    renderQueryResult(container, result, { initiallyCollapsed: false });

    const rows = Array.from(container.querySelectorAll<HTMLElement>("tbody tr"));
    expect(rows[1].hidden).toBe(false);
  });

  it("counts every work item in the tree in the header", () => {
    const result: QueryTableResult = {
      columns: COLUMNS,
      isTree: true,
      rows: [
        row(
          30,
          { "System.Id": "30", "System.Title": "Parent", "System.Description": "" },
          [
            row(31, { "System.Id": "31", "System.Title": "Child A", "System.Description": "" }),
            row(32, { "System.Id": "32", "System.Title": "Child B", "System.Description": "" }),
          ]
        ),
      ],
    };

    renderQueryResult(container, result);

    const count = container.querySelector(".powerwiki-query-table-header span");
    expect(count?.textContent).toBe("3 items");
  });
});
