// Where a wiki page opens, and in which tab.
//
// Every route into PowerWiki goes through here — the Explorer hand-off, the
// commands, and following a link inside a page — because "open this page" is
// one decision and it was previously made three times, differently.
//
// Two rules:
//
//   * **Reuse the tab.** Browsing a wiki is browsing, not accumulating windows,
//     so a page opens in the *preview* tab, the same one a single Explorer
//     click uses. Following ten links leaves one tab, not ten. VS Code's own
//     `workbench.editor.enablePreview` still governs this: someone who has
//     turned preview tabs off has asked for a tab per file, and gets one.
//   * **Never open the same page twice.** If a tab for the page already exists
//     anywhere, reveal it instead of making a second one — otherwise a link
//     back to a page you already have open silently duplicates it.

import * as vscode from "vscode";

export const PAGE_VIEW_TYPE = "powerwiki.page";

export interface OpenPageOptions {
  /**
   * Open as a permanent tab rather than the reusable preview one.
   *
   * Only the Explorer hand-off sets this, and only to preserve what VS Code had
   * already decided: a double-clicked file arrives in a permanent tab, and
   * turning it into a preview tab on the way to PowerWiki would quietly undo
   * the user's choice. Nothing else pins — which tab a page opens in is not the
   * business of the command that opened it.
   */
  readonly pin?: boolean;
  readonly viewColumn?: vscode.ViewColumn;
}

/**
 * Opens a wiki page in PowerWiki, reusing an existing tab where there is one.
 *
 * Returns false when VS Code refused to open it, so callers can say so rather
 * than leaving the user looking at an unchanged screen.
 */
export async function openWikiPage(
  uri: vscode.Uri,
  options: OpenPageOptions = {}
): Promise<boolean> {
  const existing = findPageTab(uri);

  try {
    await vscode.commands.executeCommand("vscode.openWith", uri, PAGE_VIEW_TYPE, {
      // Revealing an open page must not move it or change its pinned state:
      // stealing a pinned tab back into preview would throw it away on the
      // next navigation.
      viewColumn: existing?.group.viewColumn ?? options.viewColumn ?? vscode.ViewColumn.Active,
      preview: existing ? existing.tab.isPreview : !options.pin,
      preserveFocus: false
    } satisfies vscode.TextDocumentShowOptions);
    return true;
  } catch {
    return false;
  }
}

/** An open PowerWiki tab for this file, if there is one, and the group holding it. */
export function findPageTab(
  uri: vscode.Uri
): { tab: vscode.Tab; group: vscode.TabGroup } | undefined {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (
        input instanceof vscode.TabInputCustom &&
        input.viewType === PAGE_VIEW_TYPE &&
        sameFile(input.uri, uri)
      ) {
        return { tab, group };
      }
    }
  }

  return undefined;
}

/**
 * Closes plain-text tabs for a file that PowerWiki has just taken over.
 *
 * The hand-off opens a second editor for the same resource, and VS Code keeps
 * both — which is the "it opened twice" everyone sees first. Only unmodified
 * tabs are closed: a dirty buffer is someone's unsaved work, and it is theirs
 * to resolve, not ours to discard.
 */
export async function closeTextTabsFor(uri: vscode.Uri): Promise<void> {
  const stale = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        tab.input instanceof vscode.TabInputText && sameFile(tab.input.uri, uri) && !tab.isDirty
    );

  if (stale.length > 0) {
    await vscode.window.tabGroups.close(stale, true);
  }
}

/**
 * Windows paths differ only in case, and a URI built from `path.join` can carry
 * a different drive-letter case than the one VS Code recorded, so comparing the
 * strings directly would miss a match and open a duplicate.
 */
function sameFile(a: vscode.Uri, b: vscode.Uri): boolean {
  if (a.toString() === b.toString()) {
    return true;
  }

  return (
    process.platform === "win32" && a.fsPath.toLowerCase() === b.fsPath.toLowerCase()
  );
}
