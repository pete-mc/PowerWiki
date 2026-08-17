import { describe, expect, it } from "vitest";

import { FakeWikiRepositoryClient, type SeedPage } from "./FakeWikiRepositoryClient";

const WIKI = "sandbox-wiki";

// Latency is what makes the sandbox show loading states; it only slows tests down.
function client(seed: readonly SeedPage[] = SEED) {
  return new FakeWikiRepositoryClient(seed, { latencyMs: 0 });
}

const SEED: readonly SeedPage[] = [
  { path: "/Home", content: "# Home" },
  { path: "/Guides", content: "# Guides" },
  { path: "/Guides/A", content: "# A" },
  { path: "/Guides/B", content: "# B" },
  { path: "/Other", content: "# Other" }
];

async function childPaths(fake: FakeWikiRepositoryClient, parent: string) {
  const children = await fake.getChildPages(WIKI, parent);
  return children.map((child) => child.path);
}

describe("FakeWikiRepositoryClient", () => {
  it("returns root pages in seed order, and marks parents", async () => {
    const fake = client();
    const roots = await fake.getChildPages(WIKI, "/");
    expect(roots.map((page) => page.path)).toEqual(["/Home", "/Guides", "/Other"]);
    expect(roots.map((page) => page.order)).toEqual([0, 1, 2]);
    expect(roots.find((page) => page.path === "/Guides")?.isParentPage).toBe(true);
    expect(roots.find((page) => page.path === "/Home")?.isParentPage).toBe(false);
  });

  it("saves content and reads it back", async () => {
    const fake = client();
    await fake.savePage(WIKI, { content: "# Changed", path: "/Home" });
    await expect(fake.getPage(WIKI, "/Home")).resolves.toMatchObject({ content: "# Changed" });
  });

  it("rejects a duplicate page and a move onto an occupied path", async () => {
    const fake = client();
    await expect(fake.createPage(WIKI, "/Home")).rejects.toThrow(/already exists/);
    await expect(fake.movePage(WIKI, "/Guides/A", "/Guides/B", 0)).rejects.toThrow(/already exists/);
  });

  it("reports a missing page rather than resolving empty", async () => {
    const fake = client();
    await expect(fake.getPage(WIKI, "/nope")).rejects.toThrow(/not found/i);
  });

  it("deletes a page together with its subtree", async () => {
    const fake = client();
    await fake.deletePage(WIKI, "/Guides");
    expect(await childPaths(fake, "/")).toEqual(["/Home", "/Other"]);
    await expect(fake.getPage(WIKI, "/Guides/A")).rejects.toThrow(/not found/i);
  });

  it("carries children along when a parent is renamed", async () => {
    const fake = client();
    await fake.movePage(WIKI, "/Guides", "/Manuals", 1);
    expect(await childPaths(fake, "/Manuals")).toEqual(["/Manuals/A", "/Manuals/B"]);
    // Content must follow the page, not be recreated empty.
    await expect(fake.getPage(WIKI, "/Manuals/A")).resolves.toMatchObject({ content: "# A" });
  });

  it("reparents a page into another subtree", async () => {
    const fake = client();
    await fake.movePage(WIKI, "/Other", "/Guides/Other", 0);
    expect(await childPaths(fake, "/Guides")).toEqual(["/Guides/Other", "/Guides/A", "/Guides/B"]);
    expect(await childPaths(fake, "/")).toEqual(["/Home", "/Guides"]);
  });

  it("reorders siblings without leaving duplicate slots", async () => {
    const fake = client();
    // Move the first root page to the end.
    await fake.movePage(WIKI, "/Home", "/Home", 2);
    const roots = await fake.getChildPages(WIKI, "/");
    expect(roots.map((page) => page.path)).toEqual(["/Guides", "/Other", "/Home"]);
    expect(roots.map((page) => page.order)).toEqual([0, 1, 2]);
  });

  it("clamps an out-of-range order instead of creating a gap", async () => {
    const fake = client();
    await fake.movePage(WIKI, "/Home", "/Home", 99);
    const roots = await fake.getChildPages(WIKI, "/");
    expect(roots.map((page) => page.path)).toEqual(["/Guides", "/Other", "/Home"]);
    expect(roots.map((page) => page.order)).toEqual([0, 1, 2]);
  });

  it("appends a new page after its existing siblings", async () => {
    const fake = client();
    await fake.createPage(WIKI, "/Guides/C", "# C");
    expect(await childPaths(fake, "/Guides")).toEqual(["/Guides/A", "/Guides/B", "/Guides/C"]);
  });

  it("keeps comments per page", async () => {
    const fake = client();
    const { id } = await fake.getPageMeta(WIKI, "/Home");
    const other = await fake.getPageMeta(WIKI, "/Other");
    await fake.addComment(WIKI, id!, "first");
    await fake.addComment(WIKI, id!, "second");

    const comments = await fake.listComments(WIKI, id!);
    expect(comments.map((comment) => comment.text)).toEqual(["first", "second"]);
    await expect(fake.listComments(WIKI, other.id!)).resolves.toEqual([]);
  });

  it("exposes a single wiki and a synthetic revision so history opens", async () => {
    const fake = client();
    await expect(fake.getWikis()).resolves.toHaveLength(1);
    const revisions = await fake.getPageRevisions();
    expect(revisions).toHaveLength(1);
    const older = await fake.getPageContentAtCommit("repo", "/Home.md", revisions[0]!.commitId);
    expect(older).toContain("# Home");
  });

  // The tree loads a level at a time, so the name filter can only see a page
  // nobody expanded if this returns the whole wiki in one go.
  it("returns every page, not just the root level", async () => {
    const fake = client();

    const roots = await fake.getChildPages(WIKI, "/");
    const all = await fake.getAllPages(WIKI);

    expect(roots.map((page) => page.path)).toEqual(["/Home", "/Guides", "/Other"]);
    // The nested pages are the point: they are what a lazy tree has not loaded.
    expect(all.map((page) => page.path).sort()).toEqual([
      "/Guides",
      "/Guides/A",
      "/Guides/B",
      "/Home",
      "/Other"
    ]);
    expect(all.find((page) => page.path === "/Guides")?.isParentPage).toBe(true);
  });
});
