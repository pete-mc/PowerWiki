import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GitWikiRepositoryClient } from "./GitWikiRepositoryClient";
import type { DiscoveredWiki } from "./wikiDiscovery";

let root: string;
let wiki: DiscoveredWiki;
let client: GitWikiRepositoryClient;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "powerwiki-clone-"));
  wiki = { rootPath: root, name: "Test.wiki", mappedPath: "/", evidence: "order-file" };
  client = new GitWikiRepositoryClient([wiki]);
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

async function write(relativePath: string, contents: string) {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents, "utf8");
}

async function read(relativePath: string) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

async function exists(relativePath: string) {
  return fs
    .stat(path.join(root, relativePath))
    .then(() => true)
    .catch(() => false);
}

describe("GitWikiRepositoryClient", () => {
  it("reads a page, decoding its file name back to a page path", async () => {
    await write("Getting-Started.md", "# Start here\n");
    await write("Well%2Dknown.md", "hyphenated\n");

    expect((await client.getPage(root, "/Getting Started")).content).toBe("# Start here\n");
    expect((await client.getPage(root, "/Well-known")).content).toBe("hyphenated\n");
    await expect(client.getPage(root, "/Missing")).rejects.toThrow("Page not found");
  });

  it("orders children by .order and appends the rest alphabetically", async () => {
    await write(".order", "Home\nGuide\n");
    await write("Home.md", "");
    await write("Guide.md", "");
    await write("Zebra.md", "");

    const children = await client.getChildPages(root, "/");

    expect(children.map((child) => child.path)).toEqual(["/Home", "/Guide", "/Zebra"]);
    expect(children.map((child) => child.order)).toEqual([0, 1, 2]);
  });

  it("treats a folder as a page whether or not it has a Markdown file", async () => {
    await write("Parent.md", "content");
    await write("Parent/Child.md", "child");
    await write("Container/Leaf.md", "leaf");

    const top = await client.getChildPages(root, "/");

    expect(top.map((child) => [child.path, child.isParentPage])).toEqual([
      ["/Container", true],
      ["/Parent", true]
    ]);
    // A folder with no Markdown beside it is an empty parent page, not a 404.
    expect((await client.getPage(root, "/Container")).content).toBe("");
  });

  it("flattens the whole wiki in one walk", async () => {
    await write("A.md", "");
    await write("A/B.md", "");
    await write("A/B/C.md", "");

    const pages = await client.getAllPages(root);

    expect(pages.map((page) => page.path)).toEqual(["/A", "/A/B", "/A/B/C"]);
  });

  it("creates a page and adds it to an existing .order", async () => {
    await write(".order", "Home\n");
    await write("Home.md", "");

    await client.createPage(root, "/New Page", "# New\n");

    expect(await read("New-Page.md")).toBe("# New\n");
    expect(await read(".order")).toBe("Home\nNew-Page\n");
    await expect(client.createPage(root, "/New Page")).rejects.toThrow("already exists");
  });

  // A wiki whose author never reordered anything has no .order files at all;
  // creating them on the first edit would be an unasked-for diff in every folder.
  it("does not create a .order file that was not already there", async () => {
    await client.createPage(root, "/First", "hello");

    expect(await exists(".order")).toBe(false);
  });

  it("deletes a page together with its sub-pages", async () => {
    await write(".order", "Parent\nOther\n");
    await write("Parent.md", "");
    await write("Parent/Child.md", "");
    await write("Other.md", "");

    await client.deletePage(root, "/Parent");

    expect(await exists("Parent.md")).toBe(false);
    expect(await exists("Parent/Child.md")).toBe(false);
    expect(await read(".order")).toBe("Other\n");
  });

  it("moves a page with its children and fixes both .order files", async () => {
    await write(".order", "Source\nTarget\n");
    await write("Source.md", "source");
    await write("Source/Child.md", "child");
    await write("Target.md", "");
    await write("Target/.order", "Existing\n");
    await write("Target/Existing.md", "");

    await client.movePage(root, "/Source", "/Target/Source", 0);

    expect(await read("Target/Source.md")).toBe("source");
    expect(await read("Target/Source/Child.md")).toBe("child");
    expect(await read(".order")).toBe("Target\n");
    expect(await read("Target/.order")).toBe("Source\nExisting\n");
  });

  // Drag-to-reorder in the tree calls movePage with an unchanged path.
  it("reorders a page in place", async () => {
    await write(".order", "A\nB\nC\n");
    for (const name of ["A", "B", "C"]) {
      await write(`${name}.md`, "");
    }

    await client.movePage(root, "/C", "/C", 0);

    expect(await read(".order")).toBe("C\nA\nB\n");
  });

  it("refuses to move a page onto an existing one", async () => {
    await write("A.md", "");
    await write("B.md", "");

    await expect(client.movePage(root, "/A", "/B", 0)).rejects.toThrow("already exists");
  });

  // Unlike the wiki attachments REST API, which is create-only (see AGENTS.md),
  // a file on disk can simply be replaced.
  it("stores and replaces attachments", async () => {
    await client.createAttachment(root, "diagram.png", Buffer.from("first").toString("base64"));
    await client.createAttachment(root, "diagram.png", Buffer.from("second").toString("base64"));

    expect(await read(".attachments/diagram.png")).toBe("second");
    expect(await client.listAttachments(root)).toEqual([
      { name: "diagram.png", path: "/.attachments/diagram.png" }
    ]);
  });

  it("reads attachment bytes but refuses to escape the wiki root", async () => {
    await client.createAttachment(root, "a.bin", Buffer.from("bytes").toString("base64"));

    const bytes = await client.getItemBytes(root, "/.attachments/a.bin");

    expect(Buffer.from(bytes).toString()).toBe("bytes");
    // Page Markdown is untrusted input, and here a path traversal would be a
    // real file read rather than a 404 from the service.
    await expect(client.getItemBytes(root, "/../../etc/passwd")).rejects.toThrow("outside the wiki");
  });

  it("has no comments, and says so rather than pretending", async () => {
    expect(await client.listComments()).toEqual([]);
    await expect(client.addComment()).rejects.toThrow("not available offline");
  });
});

describe("GitWikiRepositoryClient history", () => {
  let gitAvailable = true;

  beforeEach(async () => {
    try {
      const run = (...args: string[]) =>
        execFileSync("git", args, { cwd: root, stdio: "pipe", encoding: "utf8" });
      run("init", "--quiet", "--initial-branch=main");
      run("config", "user.email", "test@example.com");
      run("config", "user.name", "Test Author");

      await write("Home.md", "first\n");
      run("add", ".");
      run("commit", "--quiet", "-m", "Add Home");

      await write("Home.md", "second\n");
      run("commit", "--quiet", "-am", "Update Home");

      wiki = { ...wiki, repositoryPath: root };
      client = new GitWikiRepositoryClient([wiki]);
    } catch {
      gitAvailable = false;
    }
  });

  it("reports revisions, the last change, and content at a commit", async () => {
    if (!gitAvailable) {
      return;
    }

    const { gitItemPath } = await client.getPageMeta(root, "/Home");
    const revisions = await client.getPageRevisions(root, gitItemPath ?? "");

    expect(revisions.map((revision) => revision.comment)).toEqual(["Update Home", "Add Home"]);
    expect(revisions[0].authorName).toBe("Test Author");

    const lastChange = await client.getPageLastChange(root, gitItemPath ?? "");
    expect(lastChange?.authorName).toBe("Test Author");

    const original = await client.getPageContentAtCommit(root, gitItemPath ?? "", revisions[1].commitId);
    expect(original).toBe("first\n");
  });

  it("returns no history for a wiki that is not in a repository", async () => {
    const detached = new GitWikiRepositoryClient([{ ...wiki, repositoryPath: undefined }]);

    expect(await detached.getPageRevisions(root, "Home.md")).toEqual([]);
    expect(await detached.getPageLastChange(root, "Home.md")).toBeUndefined();
  });
});
