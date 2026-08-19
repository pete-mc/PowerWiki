// The `.order` file, which is how an Azure DevOps wiki records the order of
// pages within a folder.
//
// It is a plain list of file-name stems (no `.md`), one per line, in display
// order. Pages present on disk but missing from `.order` still exist — the
// built-in wiki shows them after the listed ones, alphabetically — so reading
// has to merge the two rather than trust the file, and writing has to preserve
// entries for pages we did not touch.

export interface OrderedNames {
  /** Stems listed in `.order`, in order. */
  readonly listed: readonly string[];
}

export function parseOrderFile(contents: string): OrderedNames {
  const listed = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    // A stem is stored without its extension, but tolerate one: a hand-edited
    // .order with "Home.md" in it should still order Home.
    .map((line) => line.replace(/\.md$/i, ""));

  return { listed };
}

export function formatOrderFile(names: readonly string[]): string {
  return names.length > 0 ? `${names.join("\n")}\n` : "";
}

/**
 * The display order of a folder's page stems: those named in `.order` first, in
 * that order, then anything else alphabetically.
 *
 * The trailing group is what keeps a page added by `git pull` (or by hand)
 * visible instead of silently absent from the tree.
 */
export function applyOrder(present: readonly string[], order: OrderedNames): string[] {
  const remaining = new Set(present);
  const ordered: string[] = [];

  for (const name of order.listed) {
    if (remaining.delete(name)) {
      ordered.push(name);
    }
  }

  return [...ordered, ...[...remaining].sort((a, b) => a.localeCompare(b))];
}

/**
 * `.order` contents after inserting `name` at `index`.
 *
 * Entries for pages that are not present are kept: a `.order` may legitimately
 * name a page on another branch, and dropping it would produce a spurious diff.
 */
export function insertIntoOrder(order: OrderedNames, name: string, index: number): string[] {
  const without = order.listed.filter((entry) => entry !== name);
  const clamped = Math.max(0, Math.min(index, without.length));
  return [...without.slice(0, clamped), name, ...without.slice(clamped)];
}

export function removeFromOrder(order: OrderedNames, name: string): string[] {
  return order.listed.filter((entry) => entry !== name);
}

export function renameInOrder(order: OrderedNames, from: string, to: string): string[] {
  return order.listed.map((entry) => (entry === from ? to : entry));
}
