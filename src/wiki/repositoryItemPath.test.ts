import { describe, expect, it } from "vitest";

import { joinRepositoryPath } from "./repositoryItemPath";

// A wiki can be mapped to a subfolder of its repository, so a page's
// `/.attachments/x.png` is not necessarily the repository's
// `/.attachments/x.png`. Both hosts rely on this join to find a file — Azure
// DevOps to build an Items API URL, VS Code to read from disk — so getting it
// wrong shows up as every attachment image being broken, in both extensions.
describe("joinRepositoryPath", () => {
  it("returns the wiki path unchanged when the wiki is the repository root", () => {
    expect(joinRepositoryPath(undefined, "/.attachments/a.png")).toBe("/.attachments/a.png");
    expect(joinRepositoryPath("/", "/.attachments/a.png")).toBe("/.attachments/a.png");
    expect(joinRepositoryPath("", "/.attachments/a.png")).toBe("/.attachments/a.png");
  });

  it("prefixes the mapped path when the wiki lives in a subfolder", () => {
    expect(joinRepositoryPath("/docs/Product.wiki", "/.attachments/a.png")).toBe(
      "/docs/Product.wiki/.attachments/a.png"
    );
  });

  // The two halves arrive from different places — one from the Wiki API, one
  // parsed out of page Markdown — so neither's slashes can be assumed.
  it("does not double up or drop slashes however the parts are punctuated", () => {
    const expected = "/docs/wiki/.attachments/a.png";
    expect(joinRepositoryPath("/docs/wiki/", "/.attachments/a.png")).toBe(expected);
    expect(joinRepositoryPath("docs/wiki", ".attachments/a.png")).toBe(expected);
    expect(joinRepositoryPath("/docs/wiki", ".attachments/a.png")).toBe(expected);
    expect(joinRepositoryPath("docs/wiki/", "/.attachments/a.png")).toBe(expected);
  });

  it("always returns an absolute path", () => {
    expect(joinRepositoryPath("docs", "page.md").startsWith("/")).toBe(true);
    expect(joinRepositoryPath(undefined, "page.md")).toBe("/page.md");
  });

  it("handles an empty wiki path as the mapped root itself", () => {
    expect(joinRepositoryPath("/docs/wiki", "")).toBe("/docs/wiki");
    expect(joinRepositoryPath(undefined, "")).toBe("/");
  });

  it("keeps spaces and encoded characters as given", () => {
    // The caller has already decided how the path is spelled; re-encoding here
    // would corrupt a name that legitimately contains a percent sign.
    expect(joinRepositoryPath("/My Wiki", "/A Page.md")).toBe("/My Wiki/A Page.md");
    expect(joinRepositoryPath(undefined, "/Well%2Dknown.md")).toBe("/Well%2Dknown.md");
  });
});
