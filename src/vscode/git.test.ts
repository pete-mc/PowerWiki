import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isGitRepository, logFile, showFileAtCommit } from "./git";

// Against a real repository rather than canned stdout. The whole reason page
// history goes through `git log --follow` is that Git does rename detection
// better than a reimplementation would; asserting on a fixture string would
// test the parser while quietly assuming the behaviour that actually matters.

let repository: string;
let gitAvailable = true;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repository, stdio: "pipe", encoding: "utf8" });
}

async function write(relativePath: string, contents: string) {
  const target = path.join(repository, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents, "utf8");
}

beforeEach(async () => {
  repository = await fs.mkdtemp(path.join(os.tmpdir(), "powerwiki-git-"));
  try {
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.email", "tester@example.com");
    git("config", "user.name", "Test Author");
  } catch {
    gitAvailable = false;
  }
});

afterEach(async () => {
  await fs.rm(repository, { force: true, recursive: true });
});

describe("git helpers", () => {
  it("recognises a work tree, and a directory that is not one", async () => {
    if (!gitAvailable) return;

    expect(await isGitRepository(repository)).toBe(true);

    const plain = await fs.mkdtemp(path.join(os.tmpdir(), "powerwiki-plain-"));
    try {
      expect(await isGitRepository(plain)).toBe(false);
    } finally {
      await fs.rm(plain, { force: true, recursive: true });
    }
  });

  it("returns commits newest first, with author and ISO date", async () => {
    if (!gitAvailable) return;

    await write("Home.md", "one\n");
    git("add", ".");
    git("commit", "--quiet", "-m", "Add Home");
    await write("Home.md", "two\n");
    git("commit", "--quiet", "-am", "Update Home");

    const commits = await logFile(repository, "Home.md");

    expect(commits.map((commit) => commit.comment)).toEqual(["Update Home", "Add Home"]);
    expect(commits[0].authorName).toBe("Test Author");
    expect(commits[0].commitId).toMatch(/^[0-9a-f]{40}$/);
    expect(Number.isNaN(Date.parse(commits[0].date))).toBe(false);
  });

  // The whole point of --follow. Without it a renamed page appears to have been
  // created on the day it was renamed, which is exactly the history people go
  // looking for after a reorganisation.
  it("follows a page's history across a rename", async () => {
    if (!gitAvailable) return;

    await write("Before.md", "original\n");
    git("add", ".");
    git("commit", "--quiet", "-m", "Create the page");
    git("mv", "Before.md", "After.md");
    git("commit", "--quiet", "-m", "Rename the page");

    const commits = await logFile(repository, "After.md");

    expect(commits.map((commit) => commit.comment)).toEqual([
      "Rename the page",
      "Create the page"
    ]);
  });

  // Commit subjects are user input. The fields are split on a Unit Separator
  // precisely so a subject containing the obvious delimiters cannot corrupt the
  // parse — a subject with a tab or a pipe in it used to be a plausible way to
  // shift every field along by one.
  it("parses a commit subject containing delimiter-like characters", async () => {
    if (!gitAvailable) return;

    const subject = 'Fix a|b\tc "quoted" and, commas — plus a really long tail';
    await write("Home.md", "x\n");
    git("add", ".");
    git("commit", "--quiet", "-m", subject);

    const [commit] = await logFile(repository, "Home.md");

    expect(commit.comment).toBe(subject);
    expect(commit.authorName).toBe("Test Author");
  });

  it("honours the commit limit", async () => {
    if (!gitAvailable) return;

    for (let index = 0; index < 4; index += 1) {
      await write("Home.md", `revision ${index}\n`);
      git("add", ".");
      git("commit", "--quiet", "-m", `Revision ${index}`);
    }

    expect(await logFile(repository, "Home.md", 2)).toHaveLength(2);
  });

  // A page that has never been committed, or a path that does not exist, has no
  // history. That is an ordinary state for a new page, not an error.
  it("reports no history rather than failing for an untracked or unknown path", async () => {
    if (!gitAvailable) return;

    await write("Untracked.md", "not committed\n");

    expect(await logFile(repository, "Untracked.md")).toEqual([]);
    expect(await logFile(repository, "Nonexistent.md")).toEqual([]);
    expect(await logFile(os.tmpdir(), "Home.md")).toEqual([]);
  });

  it("reads a file's contents at an earlier commit", async () => {
    if (!gitAvailable) return;

    await write("Home.md", "first\n");
    git("add", ".");
    git("commit", "--quiet", "-m", "First");
    await write("Home.md", "second\n");
    git("commit", "--quiet", "-am", "Second");

    const [, older] = await logFile(repository, "Home.md");

    expect(await showFileAtCommit(repository, "Home.md", older.commitId)).toBe("first\n");
  });

  // Restoring an old revision of a page asks for content that may not exist at
  // that commit; undefined is what lets the caller say so.
  it("returns undefined for a file that did not exist at that commit", async () => {
    if (!gitAvailable) return;

    await write("Home.md", "first\n");
    git("add", ".");
    git("commit", "--quiet", "-m", "First");
    const [only] = await logFile(repository, "Home.md");

    expect(await showFileAtCommit(repository, "Later.md", only.commitId)).toBeUndefined();
    expect(await showFileAtCommit(repository, "Home.md", "0".repeat(40))).toBeUndefined();
  });
});
