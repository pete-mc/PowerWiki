// Activation for the PowerWiki VS Code extension.

import * as path from "node:path";
import * as vscode from "vscode";

import { closeTextTabsFor, openWikiPage } from "./pageEditors";
import { PowerWikiEditorProvider } from "./PowerWikiEditorProvider";
import { pagePathToRelativePath } from "../wiki/wikiPathEncoding";
import { CONFIGURATION_SECTION, WikiWorkspace } from "./wikiWorkspace";

/** Exposed to the integration tests, which need the real provider and workspace. */
export interface PowerWikiApi {
  readonly workspace: WikiWorkspace;
  readonly provider: PowerWikiEditorProvider;
}

export async function activate(context: vscode.ExtensionContext): Promise<PowerWikiApi> {
  const workspace = new WikiWorkspace();
  context.subscriptions.push(workspace);
  await workspace.refresh();

  const provider = new PowerWikiEditorProvider(context, workspace);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(PowerWikiEditorProvider.viewType, provider, {
      // Keep the webview (and any unsaved draft in it) alive when the tab is
      // backgrounded. Re-rendering a page on every tab switch would also throw
      // away scroll position and Mermaid renders.
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false
    })
  );

  // The hand-off needs to know when "Open as Markdown" ran, so that it does not
  // immediately undo it; sharing one object is what keeps the two in step.
  const handoff = new ExplorerHandoff(workspace);
  context.subscriptions.push(handoff);

  context.subscriptions.push(
    vscode.commands.registerCommand("powerwiki.openPage", (uri?: vscode.Uri) =>
      openWithPowerWiki(uri ?? vscode.window.activeTextEditor?.document.uri)
    ),
    vscode.commands.registerCommand("powerwiki.openAsText", (uri?: vscode.Uri) =>
      openAsText(uri, handoff)
    ),
    vscode.commands.registerCommand("powerwiki.openHome", (wikiRoot?: string) =>
      openHome(workspace, wikiRoot)
    ),
    vscode.commands.registerCommand("powerwiki.refreshWikis", async () => {
      await workspace.refresh();
      void vscode.window.showInformationMessage(
        `PowerWiki found ${workspace.discovered.length} wiki(s).`
      );
    })
  );

  // Drives the `powerwiki.hasWiki` context key, which is what keeps the
  // commands out of the palette in a window with no wiki in it.
  const applyContext = () =>
    void vscode.commands.executeCommand(
      "setContext",
      "powerwiki.hasWiki",
      workspace.discovered.length > 0
    );
  context.subscriptions.push(workspace.onDidChangeWikis(applyContext));
  applyContext();

  return { workspace, provider };
}

export function deactivate(): void {}

/**
 * Opening a wiki page from the Explorer.
 *
 * The custom editor is registered with `priority: option`, so VS Code opens
 * Markdown as text by default — hijacking every `.md` file in every project
 * would be indefensible. Instead, when a text editor opens a file inside a
 * *detected wiki*, it is handed over to PowerWiki. That is what makes the
 * Explorer the page tree without taking over anything else.
 *
 * The hand-off is the fiddly part, because it reacts to an event that its own
 * work causes:
 *
 *   * opening the custom editor changes the active editor, which fires this
 *     again for the same file — so an in-flight file is ignored, and the flag
 *     is *checked* rather than consumed (a guard that clears itself on the
 *     first read protects nothing);
 *   * the text editor VS Code already opened stays open beside the new one
 *     unless it is closed, which is the "it opened twice" people notice first;
 *   * "Open as Markdown" opens a text editor deliberately, so it has to be
 *     able to say "not this one" — otherwise it bounces straight back.
 */
class ExplorerHandoff implements vscode.Disposable {
  private readonly inFlight = new Set<string>();
  private readonly allowAsText = new Set<string>();
  private readonly subscription: vscode.Disposable;

  public constructor(private readonly workspace: WikiWorkspace) {
    this.subscription = vscode.window.onDidChangeActiveTextEditor((editor) => {
      void this.handle(editor);
    });

    // Also whatever is *already* open.
    //
    // `onDidChangeActiveTextEditor` only fires on a change, and by the time this
    // extension activates the window has usually finished restoring: the editor
    // that was open last session is active, and no change event is ever coming.
    // Without this, reopening a workspace — the most ordinary way anyone arrives
    // at VS Code — left the wiki page as raw Markdown until you switched to
    // another tab and back. Same for `code page.md` from a shell.
    void this.handle(vscode.window.activeTextEditor);
  }

  /** Lets the next text editor for this file through untouched. */
  public allowText(uri: vscode.Uri): void {
    this.allowAsText.add(uri.fsPath);
  }

  public dispose(): void {
    this.subscription.dispose();
  }

  private async handle(editor: vscode.TextEditor | undefined): Promise<void> {
    if (!editor || editor.document.languageId !== "markdown") {
      return;
    }

    const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    if (!configuration.get<boolean>("openWikiPagesInPowerWiki", true)) {
      return;
    }

    const uri = editor.document.uri;
    const fsPath = uri.fsPath;

    if (this.allowAsText.delete(fsPath) || this.inFlight.has(fsPath)) {
      return;
    }

    const wiki = this.workspace.findWikiForFile(fsPath);
    if (!wiki || !this.workspace.pagePathForFile(wiki, fsPath)) {
      return;
    }

    this.inFlight.add(fsPath);
    try {
      // Inherit the text editor's own preview state, so a single Explorer click
      // (preview) still yields a reusable tab and a double click (permanent)
      // still yields a permanent one.
      const opened = await openWikiPage(uri, { pin: !isPreviewTab(uri) });
      if (opened) {
        await closeTextTabsFor(uri);
      }
    } finally {
      this.inFlight.delete(fsPath);
    }
  }
}

function isPreviewTab(uri: vscode.Uri): boolean {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .some(
      (tab) =>
        tab.input instanceof vscode.TabInputText &&
        tab.input.uri.toString() === uri.toString() &&
        tab.isPreview
    );
}

async function openWithPowerWiki(uri: vscode.Uri | undefined): Promise<void> {
  if (!uri) {
    void vscode.window.showInformationMessage("Open a Markdown file first.");
    return;
  }

  // Deliberately *not* pinned. Which tab a page lands in is VS Code's own
  // convention — single click previews, double click and editing make it
  // permanent — and it should not depend on whether the page was reached from
  // the context menu, a command, or a link inside another page.
  await openWikiPage(uri);
  await closeTextTabsFor(uri);
}

/** The escape hatch: read or edit the page's raw Markdown. */
async function openAsText(uri: vscode.Uri | undefined, handoff: ExplorerHandoff): Promise<void> {
  const target = uri ?? vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const resolved =
    target instanceof vscode.Uri
      ? target
      : (target as { uri?: vscode.Uri } | undefined)?.uri;

  if (!resolved) {
    void vscode.window.showInformationMessage("Open a wiki page first.");
    return;
  }

  // Without this the hand-off sees the text editor open and immediately turns
  // it back into a PowerWiki page, so the command appears to do nothing.
  handoff.allowText(resolved);
  await vscode.commands.executeCommand("vscode.openWith", resolved, "default");
}

/**
 * Opens a wiki's home page.
 *
 * `wikiRoot` names the wiki outright; without it, the wiki containing whatever
 * is open wins, and only a window with several wikis and nothing open falls
 * through to a picker. Guessing between three wikis every time would be worse
 * than asking, but asking when the answer is obvious is worse still.
 */
async function openHome(workspace: WikiWorkspace, wikiRoot?: string): Promise<void> {
  const wikis = workspace.discovered;
  if (wikis.length === 0) {
    void vscode.window.showWarningMessage(
      "PowerWiki found no wiki in this workspace. Set powerwiki.wikiRoots if it is somewhere unusual."
    );
    return;
  }

  const named = wikiRoot ? wikis.find((candidate) => candidate.rootPath === wikiRoot) : undefined;
  const active = vscode.window.activeTextEditor
    ? workspace.findWikiForFile(vscode.window.activeTextEditor.document.uri.fsPath)
    : undefined;

  const wiki =
    named ??
    active ??
    (wikis.length === 1
      ? wikis[0]
      : (
          await vscode.window.showQuickPick(
            wikis.map((candidate) => ({ label: candidate.name, description: candidate.rootPath, candidate })),
            { placeHolder: "Which wiki?" }
          )
        )?.candidate);

  if (!wiki) {
    return;
  }

  const pages = await workspace.repositoryClient.getChildPages(wiki.rootPath, "/");
  const home = pages.find((page) => page.path === "/Home") ?? pages[0];
  if (!home) {
    void vscode.window.showWarningMessage(`${wiki.name} has no pages yet.`);
    return;
  }

  await openWithPowerWiki(
    vscode.Uri.file(path.join(wiki.rootPath, `${pagePathToRelativePath(home.path)}.md`))
  );
}
