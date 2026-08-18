// Activation for the PowerWiki VS Code extension.

import * as path from "node:path";
import * as vscode from "vscode";

import { PowerWikiEditorProvider } from "./PowerWikiEditorProvider";
import { pagePathToRelativePath } from "./wikiPathEncoding";
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

  context.subscriptions.push(
    vscode.commands.registerCommand("powerwiki.openPage", (uri?: vscode.Uri) =>
      openWithPowerWiki(uri ?? vscode.window.activeTextEditor?.document.uri)
    ),
    vscode.commands.registerCommand("powerwiki.openAsText", (uri?: vscode.Uri) =>
      openAsText(uri)
    ),
    vscode.commands.registerCommand("powerwiki.openHome", () => openHome(workspace)),
    vscode.commands.registerCommand("powerwiki.refreshWikis", async () => {
      await workspace.refresh();
      void vscode.window.showInformationMessage(
        `PowerWiki found ${workspace.discovered.length} wiki(s).`
      );
    })
  );

  context.subscriptions.push(registerExplorerHandoff(workspace));

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
 * would be indefensible. Instead, when a text editor opens a file that is
 * inside a *detected wiki*, it is handed over to PowerWiki. That is what makes
 * the Explorer the page tree, without taking over anything else.
 */
function registerExplorerHandoff(workspace: WikiWorkspace): vscode.Disposable {
  const handedOver = new Set<string>();

  return vscode.window.onDidChangeActiveTextEditor(async (editor) => {
    if (!editor || editor.document.languageId !== "markdown") {
      return;
    }

    const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    if (!configuration.get<boolean>("openWikiPagesInPowerWiki", true)) {
      return;
    }

    const fsPath = editor.document.uri.fsPath;
    const wiki = workspace.findWikiForFile(fsPath);
    if (!wiki || !workspace.pagePathForFile(wiki, fsPath)) {
      return;
    }

    // "Open as Markdown" works by opening the text editor deliberately, so a
    // one-shot exemption is what stops this from immediately undoing it.
    if (handedOver.delete(fsPath)) {
      return;
    }

    handedOver.add(fsPath);
    try {
      await vscode.commands.executeCommand(
        "vscode.openWith",
        editor.document.uri,
        PowerWikiEditorProvider.viewType
      );
    } finally {
      handedOver.delete(fsPath);
    }
  });
}

async function openWithPowerWiki(uri: vscode.Uri | undefined): Promise<void> {
  if (!uri) {
    void vscode.window.showInformationMessage("Open a Markdown file first.");
    return;
  }

  await vscode.commands.executeCommand("vscode.openWith", uri, PowerWikiEditorProvider.viewType);
}

/** The escape hatch: read or edit the page's raw Markdown. */
async function openAsText(uri: vscode.Uri | undefined): Promise<void> {
  const target = uri ?? vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const resolved =
    target instanceof vscode.Uri
      ? target
      : (target as { uri?: vscode.Uri } | undefined)?.uri;

  if (!resolved) {
    void vscode.window.showInformationMessage("Open a wiki page first.");
    return;
  }

  await vscode.commands.executeCommand("vscode.openWith", resolved, "default");
}

async function openHome(workspace: WikiWorkspace): Promise<void> {
  const wikis = workspace.discovered;
  if (wikis.length === 0) {
    void vscode.window.showWarningMessage(
      "PowerWiki found no wiki in this workspace. Set powerwiki.wikiRoots if it is somewhere unusual."
    );
    return;
  }

  const wiki =
    wikis.length === 1
      ? wikis[0]
      : (
          await vscode.window.showQuickPick(
            wikis.map((candidate) => ({ label: candidate.name, description: candidate.rootPath, candidate })),
            { placeHolder: "Which wiki?" }
          )
        )?.candidate;

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
