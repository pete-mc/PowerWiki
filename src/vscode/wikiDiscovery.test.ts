import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverWikis, findRepositoryRoot } from "./wikiDiscovery";

let workspace: string;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "powerwiki-discovery-"));
});

afterEach(async () => {
  await fs.rm(workspace, { force: true, recursive: true });
});

async function makeWiki(directory: string, options: { order?: boolean; attachments?: boolean } = {}) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "Home.md"), "# Home\n");
  if (options.order !== false) {
    await fs.writeFile(path.join(directory, ".order"), "Home\n");
  }
  if (options.attachments) {
    await fs.mkdir(path.join(directory, ".attachments"), { recursive: true });
  }
}

describe("wiki discovery", () => {
  // Layout 1: the clone is the opened folder.
  it("finds a wiki at the workspace folder root", async () => {
    await makeWiki(workspace);

    const wikis = await discoverWikis([workspace]);

    expect(wikis).toHaveLength(1);
    expect(wikis[0].rootPath).toBe(workspace);
    expect(wikis[0].mappedPath).toBe("/");
  });

  // Layout 3: the wiki is a subfolder, so mappedPath is not "/".
  it("finds a wiki in a subfolder and records its mapped path", async () => {
    const repository = path.join(workspace, "repo");
    await fs.mkdir(path.join(repository, ".git"), { recursive: true });
    await makeWiki(path.join(repository, "docs", "MyProject.wiki"));

    const wikis = await discoverWikis([workspace], { maxDepth: 3 });

    expect(wikis).toHaveLength(1);
    expect(wikis[0].name).toBe("MyProject.wiki");
    expect(wikis[0].repositoryPath).toBe(repository);
    expect(wikis[0].mappedPath).toBe("/docs/MyProject.wiki");
  });

  // Layout 2: several folders in one workspace, only one of them a wiki.
  it("scans every workspace folder", async () => {
    const code = path.join(workspace, "code");
    const wiki = path.join(workspace, "wiki");
    await fs.mkdir(path.join(code, "src"), { recursive: true });
    await fs.writeFile(path.join(code, "src", "index.ts"), "");
    await makeWiki(wiki);

    const wikis = await discoverWikis([code, wiki]);

    expect(wikis.map((entry) => entry.rootPath)).toEqual([wiki]);
  });

  // Pages below a wiki root are that wiki's pages; each has its own .order.
  it("does not report a wiki's own subfolders as separate wikis", async () => {
    await makeWiki(workspace);
    await makeWiki(path.join(workspace, "Home"));

    const wikis = await discoverWikis([workspace], { maxDepth: 3 });

    expect(wikis.map((entry) => entry.rootPath)).toEqual([workspace]);
  });

  it("accepts a folder with .attachments but no .order", async () => {
    await makeWiki(workspace, { order: false, attachments: true });

    const wikis = await discoverWikis([workspace]);

    expect(wikis[0].evidence).toBe("attachments");
  });

  // Every repository has a docs folder; offering all of them would be noise.
  it("ignores a plain Markdown folder unless asked not to", async () => {
    await makeWiki(workspace, { order: false });

    expect(await discoverWikis([workspace])).toHaveLength(0);
    expect(await discoverWikis([workspace], { acceptMarkdownOnly: true })).toHaveLength(1);
  });

  it("does not descend into node_modules", async () => {
    await makeWiki(path.join(workspace, "node_modules", "thing"));

    expect(await discoverWikis([workspace], { maxDepth: 3 })).toHaveLength(0);
  });

  it("finds the enclosing repository, including a worktree's .git file", async () => {
    const repository = path.join(workspace, "worktree");
    await fs.mkdir(path.join(repository, "nested"), { recursive: true });
    await fs.writeFile(path.join(repository, ".git"), "gitdir: /elsewhere\n");

    expect(await findRepositoryRoot(path.join(repository, "nested"))).toBe(repository);
    expect(await findRepositoryRoot(os.tmpdir())).toBeUndefined();
  });
});
