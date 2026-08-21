import { describe, expect, it } from "vitest";

import type { LinkedWorkItem } from "./LinkedWorkItem";
import { isClosedWorkItem, orderLinkedWorkItems } from "./linkedWorkItemOrder";

const item = (id: number, stateCategory?: string): LinkedWorkItem => ({ id, stateCategory });

describe("isClosedWorkItem", () => {
  it("treats Completed and Removed as finished", () => {
    expect(isClosedWorkItem(item(1, "Completed"))).toBe(true);
    expect(isClosedWorkItem(item(2, "Removed"))).toBe(true);
  });

  it("treats everything before that as open", () => {
    expect(isClosedWorkItem(item(3, "Proposed"))).toBe(false);
    expect(isClosedWorkItem(item(4, "InProgress"))).toBe(false);
    // Resolved is not Completed: the work is done but the item is not closed.
    expect(isClosedWorkItem(item(5, "Resolved"))).toBe(false);
  });

  it("treats an unresolved category as open rather than hiding it", () => {
    expect(isClosedWorkItem(item(6))).toBe(false);
    expect(isClosedWorkItem(item(7, "SomethingCustom"))).toBe(false);
  });
});

describe("orderLinkedWorkItems", () => {
  it("puts open items first and closed ones last", () => {
    const ordered = orderLinkedWorkItems([
      item(1, "Completed"),
      item(2, "Proposed"),
      item(3, "Removed"),
      item(4, "InProgress"),
    ]);

    expect(ordered.map((entry) => entry.id)).toEqual([4, 2, 3, 1]);
  });

  it("sorts newest first within each group", () => {
    const ordered = orderLinkedWorkItems([
      item(10, "Proposed"),
      item(30, "Completed"),
      item(20, "Proposed"),
      item(40, "Completed"),
    ]);

    expect(ordered.map((entry) => entry.id)).toEqual([20, 10, 40, 30]);
  });

  it("does not mutate the array it was given", () => {
    const original = [item(1, "Completed"), item(2, "Proposed")];
    orderLinkedWorkItems(original);

    expect(original.map((entry) => entry.id)).toEqual([1, 2]);
  });

  it("copes with an empty list", () => {
    expect(orderLinkedWorkItems([])).toEqual([]);
  });
});
