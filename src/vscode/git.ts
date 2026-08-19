// The small amount of Git this extension needs: page history, and the content
// of a page at an earlier commit.
//
// Shelling out rather than using a JS Git implementation is deliberate.
// `git log --follow` is the whole feature — it reconstructs a page's history
// across renames, which the Azure DevOps commits API cannot do (see
// `src/wiki/renameHistory.ts` for the reconstruction the hub has to perform
// instead). Reimplementing rename detection would be strictly worse than
// calling the tool that already does it.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Unit Separator. A commit subject is single-line but can contain anything
 * else, so the fields are split on a byte that cannot appear in one rather than
 * on a character a commit message might legitimately use.
 */
const FIELD_SEPARATOR = "\u001f";
const LOG_FORMAT = ["%H", "%an", "%aI", "%s"].join("%x1f");

export interface GitCommit {
  readonly commitId: string;
  readonly authorName: string;
  readonly date: string;
  readonly comment: string;
}

export class GitUnavailableError extends Error {}

/**
 * Runs git in `repositoryPath`. Throws GitUnavailableError when git itself is
 * missing, so callers can say "history is unavailable" rather than surfacing a
 * spawn failure.
 */
export async function runGit(repositoryPath: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", [...args], {
      cwd: repositoryPath,
      // A page's history is small; `git show` of a stored attachment is not.
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true
    });
    return stdout;
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "ENOENT") {
      throw new GitUnavailableError("Git is not installed or not on PATH.");
    }
    throw error;
  }
}

export async function isGitRepository(repositoryPath: string): Promise<boolean> {
  try {
    return (await runGit(repositoryPath, ["rev-parse", "--is-inside-work-tree"])).trim() === "true";
  } catch {
    return false;
  }
}

/**
 * Commits that touched `relativePath`, newest first.
 *
 * `--follow` is what makes a renamed page keep its history, which is the whole
 * reason this goes through Git rather than file timestamps.
 */
export async function logFile(
  repositoryPath: string,
  relativePath: string,
  limit = 50
): Promise<GitCommit[]> {
  let output: string;
  try {
    output = await runGit(repositoryPath, [
      "log",
      "--follow",
      `--max-count=${limit}`,
      `--format=${LOG_FORMAT}`,
      "--",
      relativePath
    ]);
  } catch {
    // A never-committed page has no history, and neither does a directory that
    // turned out not to be a work tree. Both are honestly "no revisions".
    return [];
  }

  return output
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(FIELD_SEPARATOR))
    .filter((fields) => fields.length >= 4)
    .map(([commitId, authorName, date, ...rest]) => ({
      commitId,
      authorName,
      date,
      comment: rest.join(FIELD_SEPARATOR)
    }));
}

/** A file's contents at a commit, or undefined if it did not exist there. */
export async function showFileAtCommit(
  repositoryPath: string,
  relativePath: string,
  commitId: string
): Promise<string | undefined> {
  try {
    return await runGit(repositoryPath, ["show", `${commitId}:${relativePath}`]);
  } catch {
    return undefined;
  }
}
