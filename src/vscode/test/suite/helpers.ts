// Shared plumbing for the UI tests.
//
// The central problem these solve: an extension-host test process cannot reach
// inside a webview's DOM. So the webview reports what it rendered (see the
// `ScreenReporter` in src/vscode/webview/main.tsx) and the tests wait for a
// report that satisfies a predicate. That keeps the assertions about what a
// user would *see* — a heading on screen, the tree absent — rather than about
// internal state that could be right while the UI is broken.

import * as path from "node:path";
import * as vscode from "vscode";

import type { PowerWikiApi } from "../../extension";
import type { EditorScreen } from "../../PowerWikiEditorProvider";

const EXTENSION_ID = "dataversepowertools.powerwiki-vscode";

/** Rendering a page loads Monaco, Mermaid and KaTeX, which is not instant. */
export const RENDER_TIMEOUT_MS = 30_000;

export async function getApi(): Promise<PowerWikiApi> {
  const extension = vscode.extensions.getExtension<PowerWikiApi>(EXTENSION_ID);
  if (!extension) {
    throw new Error(`The ${EXTENSION_ID} extension is not installed in this test window.`);
  }

  return extension.isActive ? extension.exports : await extension.activate();
}

export function wikiFile(wikiRoot: string, relativePath: string): vscode.Uri {
  return vscode.Uri.file(path.join(wikiRoot, relativePath));
}

/**
 * Opens a page in PowerWiki and waits until its webview reports a rendered body.
 *
 * Waiting for `rendered` rather than for the command to return is the whole
 * point: `openWith` resolves as soon as the editor exists, which is before the
 * bundle has run, let alone rendered anything.
 */
export async function openPage(
  api: PowerWikiApi,
  uri: vscode.Uri,
  predicate: (screen: EditorScreen) => boolean = (screen) => screen.rendered
): Promise<EditorScreen> {
  const waiter = waitForScreen(api, uri.fsPath, predicate);
  // Through the command, not `vscode.openWith` directly: the command is how a
  // user gets here, and it is what decides which tab the page lands in. A raw
  // openWith would bypass that and quietly pin every page the tests open.
  await vscode.commands.executeCommand("powerwiki.openPage", uri);
  return await waiter;
}

/**
 * Resolves with the first screen report for `documentPath` that satisfies
 * `predicate`. Checks the last known screen first, so a report that arrived
 * before the caller started listening is not missed.
 */
export function waitForScreen(
  api: PowerWikiApi,
  documentPath: string,
  predicate: (screen: EditorScreen) => boolean,
  timeoutMs = RENDER_TIMEOUT_MS
): Promise<EditorScreen> {
  const existing = api.provider.latestScreen(documentPath);
  if (existing && predicate(existing)) {
    return Promise.resolve(existing);
  }

  return new Promise<EditorScreen>((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      const last = api.provider.latestScreen(documentPath);
      reject(
        new Error(
          `Timed out waiting for ${path.basename(documentPath)}. Last screen: ${JSON.stringify(last)}`
        )
      );
    }, timeoutMs);

    const subscription = api.provider.onDidChangeScreen((screen) => {
      if (screen.documentPath !== documentPath || !predicate(screen)) {
        return;
      }
      clearTimeout(timer);
      subscription.dispose();
      resolve(screen);
    });
  });
}

export async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
}

/** Every open tab, across groups, as `<viewType|text>:<file name>`. */
export function openTabs(): string[] {
  return vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.map((tab) => {
      const input = tab.input;
      if (input instanceof vscode.TabInputCustom) {
        return `${input.viewType}:${path.basename(input.uri.fsPath)}`;
      }
      if (input instanceof vscode.TabInputText) {
        return `text:${path.basename(input.uri.fsPath)}`;
      }
      return `other:${tab.label}`;
    })
  );
}

/**
 * Waits for the tab list to settle.
 *
 * Opening an editor and closing the text tab it replaced are separate
 * operations, so a count read immediately after `openPage` can catch the
 * moment when both are open.
 */
export async function settleTabs(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 500));
}

export function wikiRootFor(api: PowerWikiApi, name: string): string {
  const wiki = api.workspace.discovered.find((candidate) => candidate.name === name);
  if (!wiki) {
    const found = api.workspace.discovered.map((candidate) => candidate.name).join(", ");
    throw new Error(`No wiki named ${name}. Found: ${found || "none"}`);
  }
  return wiki.rootPath;
}
