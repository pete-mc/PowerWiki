/**
 * Following a wiki page's history back through renames.
 *
 * Azure DevOps' commits API has no `git log --follow` equivalent: after a page
 * is renamed, asking for the new path's history returns only the rename commit
 * and anything after it, and asking for the old path returns nothing at all
 * (the path no longer exists at the branch tip). The built-in wiki shows the
 * whole story, so PowerWiki reconstructs it.
 *
 * The rename commit records everything needed to hop backwards:
 *
 *   changeType=rename  path=/After.md  sourceServerItem=/Before.md
 *   changeType=delete, sourceRename  path=/Before.md
 *
 * Take the `sourceServerItem` from the first entry and re-query that path
 * pinned to the rename commit's *parent* commit, where it still exists. Repeat
 * for pages renamed more than once.
 *
 * This module holds the pure decisions so they can be tested against fixtures;
 * AzureDevOpsWikiRepositoryClient does the fetching.
 */

/** VersionControlChangeType.Rename — see the Git contracts enum. */
const RENAME_FLAG = 8;
/** VersionControlChangeType.Delete. */
const DELETE_FLAG = 16;

/** The subset of a Git change this module needs. */
export interface RenameCandidateChange {
  /** Bitmask (SDK) or comma-separated names (raw REST), e.g. "delete, sourceRename". */
  readonly changeType?: number | string;
  readonly item?: { readonly path?: string };
  /** Path before the change, when it differs. */
  readonly sourceServerItem?: string;
  readonly originalPath?: string;
}

export interface RenameHop {
  /** The path this page had before the rename. */
  readonly previousPath: string;
}

/**
 * Azure DevOps percent-encodes some characters in wiki item paths (a hyphen
 * arrives as `%2D` from the pages API but raw from the changes API), so paths
 * are compared decoded and case-insensitively.
 */
export function samePath(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  return decodePath(left).toLowerCase() === decodePath(right).toLowerCase();
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** True when a change represents a rename (bitmask or name-list form). */
export function isRename(changeType: number | string | undefined): boolean {
  if (typeof changeType === "number") {
    return (changeType & RENAME_FLAG) !== 0;
  }
  return typeof changeType === "string" && /(^|,\s*)rename\b/i.test(changeType);
}

/** True when a change deletes the item (the old path's half of a rename pair). */
export function isDelete(changeType: number | string | undefined): boolean {
  if (typeof changeType === "number") {
    return (changeType & DELETE_FLAG) !== 0;
  }
  return typeof changeType === "string" && /(^|,\s*)delete\b/i.test(changeType);
}

/**
 * Finds the path `path` had before this commit, if the commit renamed it.
 *
 * A rename is recorded as a pair: the new path with changeType `rename`, and
 * the old path with `delete, sourceRename`. Only the first is useful — the
 * delete entry names the old path but does not say what it became, so matching
 * on it would walk the chain in the wrong direction.
 */
export function findRenameHop(
  changes: readonly RenameCandidateChange[],
  path: string
): RenameHop | undefined {
  for (const change of changes) {
    if (isDelete(change.changeType) || !isRename(change.changeType)) {
      continue;
    }
    if (!samePath(change.item?.path, path)) {
      continue;
    }

    const previousPath = change.sourceServerItem ?? change.originalPath;
    // A rename onto the same path carries no information and would loop.
    if (previousPath && !samePath(previousPath, path)) {
      return { previousPath };
    }
  }

  return undefined;
}

/**
 * Guards the walk against a pathological or cyclic history. Pages are rarely
 * renamed more than a handful of times, and each hop costs two extra requests.
 */
export const MAX_RENAME_HOPS = 10;

/** True when this path has already been visited, which would mean a cycle. */
export function alreadyVisited(visited: readonly string[], path: string): boolean {
  return visited.some((seen) => samePath(seen, path));
}
