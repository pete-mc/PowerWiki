// Finding the wiki inside whatever the user happens to have open.
//
// Three layouts have to work, and they are not variations of one shape:
//
//   1. the wiki clone *is* the opened folder            → the folder itself
//   2. the wiki clone is one folder of a multi-root workspace → each folder
//   3. the wiki lives in a subfolder (a code wiki, or a repo holding several)
//
// So this scans each workspace folder and a bounded number of levels beneath
// it, rather than assuming the root. Bounded because an unbounded walk of a
// large monorepo on extension activation is a hang, and a wiki nested five
// levels deep is better named explicitly in settings than found by brute force.

import { promises as fs } from "node:fs";
import * as path from "node:path";

/** Directory names never worth descending into when looking for a wiki. */
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".github",
  ".vscode",
  "node_modules",
  "bin",
  "obj",
  "dist",
  "out",
  "target",
  ".attachments"
]);

export interface DiscoveredWiki {
  /** Absolute path of the wiki root (the folder holding the top-level pages). */
  readonly rootPath: string;
  /** Display name: the wiki folder, or the repository folder when they are the same. */
  readonly name: string;
  /** Absolute path of the enclosing Git work tree, when there is one. */
  readonly repositoryPath?: string;
  /** Wiki root relative to the repository, `/` when they coincide. */
  readonly mappedPath: string;
  /** What made this look like a wiki, surfaced in the "no wiki found" message. */
  readonly evidence: "order-file" | "attachments" | "markdown";
}

export interface DiscoveryOptions {
  /** How many levels below a workspace folder to look. 0 = the folder only. */
  readonly maxDepth?: number;
  /**
   * Accept a folder holding only Markdown, with no `.order` and no
   * `.attachments`. Off by default: almost every repository has a `docs/`
   * folder, and offering all of them as wikis is noise.
   */
  readonly acceptMarkdownOnly?: boolean;
}

const DEFAULT_MAX_DEPTH = 2;

/**
 * Wikis under the given workspace folders, best evidence first.
 *
 * A folder that qualifies stops the descent: pages *below* a wiki root are that
 * wiki's pages, not separate wikis, and their subfolders contain `.order` files
 * of their own.
 */
export async function discoverWikis(
  folderPaths: readonly string[],
  options: DiscoveryOptions = {}
): Promise<DiscoveredWiki[]> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const found: DiscoveredWiki[] = [];
  const seen = new Set<string>();

  for (const folderPath of folderPaths) {
    await scan(path.resolve(folderPath), 0);
  }

  async function scan(directory: string, depth: number): Promise<void> {
    if (seen.has(directory)) {
      return;
    }
    seen.add(directory);

    const evidence = await classifyDirectory(directory, options.acceptMarkdownOnly ?? false);
    if (evidence) {
      found.push(await describeWiki(directory, evidence));
      return;
    }

    if (depth >= maxDepth) {
      return;
    }

    for (const child of await subdirectories(directory)) {
      await scan(child, depth + 1);
    }
  }

  // `.order` is the strongest signal, so surface those first — with several
  // candidates the picker's default should be the one that really is a wiki.
  const rank = { "order-file": 0, attachments: 1, markdown: 2 } as const;
  return found.sort((a, b) => rank[a.evidence] - rank[b.evidence] || a.rootPath.localeCompare(b.rootPath));
}

async function classifyDirectory(
  directory: string,
  acceptMarkdownOnly: boolean
): Promise<DiscoveredWiki["evidence"] | undefined> {
  let entries: string[];
  try {
    entries = await fs.readdir(directory);
  } catch {
    return undefined;
  }

  if (entries.includes(".order")) {
    return "order-file";
  }

  const hasMarkdown = entries.some((entry) => entry.toLowerCase().endsWith(".md"));
  if (!hasMarkdown) {
    return undefined;
  }

  if (entries.includes(".attachments")) {
    return "attachments";
  }

  return acceptMarkdownOnly ? "markdown" : undefined;
}

async function describeWiki(
  rootPath: string,
  evidence: DiscoveredWiki["evidence"]
): Promise<DiscoveredWiki> {
  const repositoryPath = await findRepositoryRoot(rootPath);
  const relative = repositoryPath ? path.relative(repositoryPath, rootPath) : "";
  const mappedPath = relative ? `/${relative.split(path.sep).join("/")}` : "/";

  return {
    rootPath,
    name: path.basename(rootPath),
    repositoryPath,
    mappedPath,
    evidence
  };
}

/** Nearest ancestor (inclusive) containing `.git`, or undefined outside a repo. */
export async function findRepositoryRoot(startPath: string): Promise<string | undefined> {
  let current = path.resolve(startPath);

  for (;;) {
    try {
      // A worktree or submodule has `.git` as a file, not a directory, so this
      // deliberately checks for existence rather than for a directory.
      await fs.stat(path.join(current, ".git"));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return undefined;
      }
      current = parent;
    }
  }
}

async function subdirectories(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name))
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}
