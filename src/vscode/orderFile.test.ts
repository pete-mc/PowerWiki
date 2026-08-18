import { describe, expect, it } from "vitest";

import {
  applyOrder,
  formatOrderFile,
  insertIntoOrder,
  parseOrderFile,
  removeFromOrder,
  renameInOrder
} from "./orderFile";

describe(".order files", () => {
  it("parses one stem per line, ignoring blanks", () => {
    expect(parseOrderFile("Home\n\nGetting-Started\n").listed).toEqual(["Home", "Getting-Started"]);
  });

  it("tolerates a hand-added extension", () => {
    expect(parseOrderFile("Home.md\n").listed).toEqual(["Home"]);
  });

  // A page pulled in from another branch is on disk but not in .order. The
  // built-in wiki still lists it, so dropping it here would make pages vanish.
  it("lists pages missing from .order after the ordered ones", () => {
    const order = parseOrderFile("Home\nGuide\n");
    expect(applyOrder(["Guide", "Zebra", "Home", "Apple"], order)).toEqual([
      "Home",
      "Guide",
      "Apple",
      "Zebra"
    ]);
  });

  it("ignores .order entries with no file", () => {
    expect(applyOrder(["Home"], parseOrderFile("Home\nDeleted\n"))).toEqual(["Home"]);
  });

  it("inserts, removes and renames without disturbing other entries", () => {
    const order = parseOrderFile("A\nB\nC\n");
    expect(insertIntoOrder(order, "New", 1)).toEqual(["A", "New", "B", "C"]);
    expect(insertIntoOrder(order, "C", 0)).toEqual(["C", "A", "B"]);
    expect(insertIntoOrder(order, "New", 99)).toEqual(["A", "B", "C", "New"]);
    expect(removeFromOrder(order, "B")).toEqual(["A", "C"]);
    expect(renameInOrder(order, "B", "B2")).toEqual(["A", "B2", "C"]);
  });

  it("writes a trailing newline, and nothing at all when empty", () => {
    expect(formatOrderFile(["A", "B"])).toBe("A\nB\n");
    expect(formatOrderFile([])).toBe("");
  });
});
