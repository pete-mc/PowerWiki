import { describe, expect, it } from "vitest";

import {
  alreadyVisited,
  findRenameHop,
  isDelete,
  isRename,
  samePath,
  type RenameCandidateChange,
} from "./renameHistory";

// The shape Azure DevOps actually returns for a wiki page rename: the new path
// carries the rename, the old path is recorded as a delete/sourceRename pair.
const RENAME_PAIR: RenameCandidateChange[] = [
  { changeType: "rename", item: { path: "/After.md" }, sourceServerItem: "/Before.md" },
  { changeType: "delete, sourceRename", item: { path: "/Before.md" } },
];

describe("isRename / isDelete", () => {
  it("reads the raw REST name-list form", () => {
    expect(isRename("rename")).toBe(true);
    expect(isRename("delete, sourceRename")).toBe(false);
    expect(isDelete("delete, sourceRename")).toBe(true);
    expect(isDelete("rename")).toBe(false);
  });

  it("reads the SDK bitmask form", () => {
    expect(isRename(8)).toBe(true); // Rename
    expect(isRename(10)).toBe(true); // Edit | Rename
    expect(isRename(16)).toBe(false); // Delete
    expect(isDelete(1040)).toBe(true); // Delete | SourceRename
    expect(isDelete(8)).toBe(false);
  });

  it("does not mistake sourceRename for a rename", () => {
    // The substring "rename" appears inside "sourceRename"; only a standalone
    // token counts, otherwise the delete half of the pair would match.
    expect(isRename("sourceRename")).toBe(false);
    expect(isRename(1024)).toBe(false); // SourceRename alone
  });

  it("treats missing change types as neither", () => {
    expect(isRename(undefined)).toBe(false);
    expect(isDelete(undefined)).toBe(false);
  });
});

describe("samePath", () => {
  it("compares decoded and case-insensitively", () => {
    // The pages API percent-encodes hyphens; the changes API does not.
    expect(samePath("/My%2DPage.md", "/My-Page.md")).toBe(true);
    expect(samePath("/my-page.md", "/My-Page.md")).toBe(true);
    expect(samePath("/A.md", "/B.md")).toBe(false);
  });

  it("survives malformed encoding rather than throwing", () => {
    expect(samePath("/100%.md", "/100%.md")).toBe(true);
  });

  it("is false when either side is missing", () => {
    expect(samePath(undefined, "/A.md")).toBe(false);
    expect(samePath("/A.md", undefined)).toBe(false);
  });
});

describe("findRenameHop", () => {
  it("finds the previous path from the rename half of the pair", () => {
    expect(findRenameHop(RENAME_PAIR, "/After.md")).toEqual({ previousPath: "/Before.md" });
  });

  it("matches the path even when the encoding differs", () => {
    expect(findRenameHop(RENAME_PAIR, "/after.md")).toEqual({ previousPath: "/Before.md" });
    const encoded: RenameCandidateChange[] = [
      { changeType: "rename", item: { path: "/My-Page.md" }, sourceServerItem: "/Old-Page.md" },
    ];
    expect(findRenameHop(encoded, "/My%2DPage.md")).toEqual({ previousPath: "/Old-Page.md" });
  });

  it("ignores the delete half, which would walk the chain backwards", () => {
    // Asking about the OLD path must not produce a hop: that entry says what was
    // removed, not what it became.
    expect(findRenameHop(RENAME_PAIR, "/Before.md")).toBeUndefined();
  });

  it("ignores renames of other files in the same commit", () => {
    const changes: RenameCandidateChange[] = [
      { changeType: "rename", item: { path: "/Other.md" }, sourceServerItem: "/OtherOld.md" },
      ...RENAME_PAIR,
    ];
    expect(findRenameHop(changes, "/After.md")).toEqual({ previousPath: "/Before.md" });
    expect(findRenameHop(changes, "/Other.md")).toEqual({ previousPath: "/OtherOld.md" });
  });

  it("returns nothing for an ordinary edit commit", () => {
    const changes: RenameCandidateChange[] = [{ changeType: "edit", item: { path: "/After.md" } }];
    expect(findRenameHop(changes, "/After.md")).toBeUndefined();
  });

  it("falls back to originalPath when sourceServerItem is absent", () => {
    const changes: RenameCandidateChange[] = [
      { changeType: 8, item: { path: "/After.md" }, originalPath: "/Before.md" },
    ];
    expect(findRenameHop(changes, "/After.md")).toEqual({ previousPath: "/Before.md" });
  });

  it("refuses a self-referential rename that would loop forever", () => {
    const changes: RenameCandidateChange[] = [
      { changeType: "rename", item: { path: "/Same.md" }, sourceServerItem: "/Same.md" },
    ];
    expect(findRenameHop(changes, "/Same.md")).toBeUndefined();
  });

  it("handles an empty change set", () => {
    expect(findRenameHop([], "/After.md")).toBeUndefined();
  });
});

describe("alreadyVisited", () => {
  it("detects a revisited path regardless of encoding", () => {
    expect(alreadyVisited(["/A.md", "/My%2DB.md"], "/My-B.md")).toBe(true);
    expect(alreadyVisited(["/A.md"], "/C.md")).toBe(false);
    expect(alreadyVisited([], "/A.md")).toBe(false);
  });
});
