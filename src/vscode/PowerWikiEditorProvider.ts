// PowerWiki as a VS Code editor for a wiki page.
//
// A `CustomTextEditorProvider` rather than a standalone panel, because the
// editor is what makes the Explorer the page tree: clicking a file opens this,
// the tab is the file, closing the tab closes the page, and split/preview/
// history all behave the way every other editor does. A panel would have needed
// its own navigation model bolted alongside VS Code's.

import * as path from "node:path";
import * as vscode from "vscode";

import type { WikiHostCapabilities, WikiHostContext } from "../host/WikiHost";
import type { ExtensionMessage, RpcRequest, StateMessage, WebviewMessage } from "./protocol";
import { BINARY_WIKI_METHODS } from "./protocol";
import { closeTextTabsFor, openWikiPage } from "./pageEditors";
import { pagePathToRelativePath } from "./wikiPathEncoding";
import type { WikiWorkspace } from "./wikiWorkspace";

/** Matches the VS Code host's own declaration; sent so the webview cannot drift. */
const VS_CODE_CAPABILITIES: WikiHostCapabilities = {
  comments: false,
  follow: false,
  workItems: false,
  mentions: false,
  pageTree: false,
  wikiSelector: false,
  search: true,
  permalinks: false,
  printToPdf: false,
  vsCodeHandoff: false
};

/** What a webview last reported it was showing. Exposed for the UI tests. */
export interface EditorScreen extends Omit<StateMessage, "type"> {
  readonly documentPath: string;
}

export class PowerWikiEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "powerwiki.page";

  private readonly screens = new Map<string, EditorScreen>();
  private readonly screenChanged = new vscode.EventEmitter<EditorScreen>();

  /** Fires whenever a webview reports new on-screen state. Used by the tests. */
  public readonly onDidChangeScreen = this.screenChanged.event;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly workspace: WikiWorkspace
  ) {}

  public latestScreen(documentPath: string): EditorScreen | undefined {
    return this.screens.get(documentPath);
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): Promise<void> {
    const wiki = this.workspace.findWikiForFile(document.uri.fsPath);
    const pagePath = wiki ? this.workspace.pagePathForFile(wiki, document.uri.fsPath) : undefined;

    if (!wiki || !pagePath) {
      // Being explicit beats rendering an empty shell: the usual cause is a
      // Markdown file that is simply not part of a wiki, and the way out is to
      // open it as text.
      panel.webview.options = { enableScripts: false };
      panel.webview.html = notAWikiPageHtml(document.uri);
      return;
    }

    const wikiRootUri = vscode.Uri.file(wiki.rootPath);
    panel.webview.options = {
      enableScripts: true,
      // The wiki root is readable so attachment images resolve as ordinary
      // files; `dist` holds the bundle and Monaco's assets.
      localResourceRoots: [wikiRootUri, vscode.Uri.joinPath(this.context.extensionUri, "dist")]
    };
    panel.webview.html = this.buildHtml(panel.webview);

    const disposables: vscode.Disposable[] = [];
    let editing = false;
    let initialised = false;

    const sendInit = async () => {
      // A webview reloads itself after an external file change, so "ready" can
      // arrive more than once; re-sending init is what makes that reload land
      // on the same page rather than an empty shell.
      const wikis = await this.workspace.repositoryClient.getWikis();
      await post(panel, {
        type: "init",
        capabilities: VS_CODE_CAPABILITIES,
        context: buildContext(wiki.name),
        wikis,
        activeWikiId: wiki.rootPath,
        activePagePath: pagePath,
        logoUrl: panel.webview
          .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "media", "logo_new.png"))
          .toString(),
        attachmentBaseUrl: `${panel.webview.asWebviewUri(wikiRootUri).toString()}/`,
        monacoBaseUrl: panel.webview
          .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "vs"))
          .toString()
      });
      initialised = true;
    };

    disposables.push(
      panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        if (message.type === "ready") {
          void sendInit();
          return;
        }

        if (message.type === "state") {
          // A preview tab is replaced by the next page opened in it. PowerWiki's
          // draft lives in the webview, not in the TextDocument, so the tab is
          // not "dirty" and VS Code has no way to know there is anything to
          // lose — pin it ourselves the moment editing starts, which is what
          // VS Code does for a document the user has typed into.
          if (message.editing && !editing && panel.active) {
            void vscode.commands.executeCommand("workbench.action.keepEditor");
          }
          editing = message.editing;
          const screen: EditorScreen = { ...message, documentPath: document.uri.fsPath };
          this.screens.set(document.uri.fsPath, screen);
          this.screenChanged.fire(screen);
          return;
        }

        void this.handleRequest(panel, message, wiki.rootPath);
      })
    );

    // The file can change under us: `git pull`, another editor, or PowerWiki's
    // own link rewriting after a rename. Reload unless someone is mid-edit, in
    // which case their draft matters more than being current.
    disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.fsPath !== document.uri.fsPath || event.contentChanges.length === 0) {
          return;
        }
        if (!editing) {
          void post(panel, { type: "reload" });
        }
      })
    );

    disposables.push(
      panel.onDidDispose(() => {
        this.screens.delete(document.uri.fsPath);
        for (const disposable of disposables) {
          disposable.dispose();
        }
      })
    );

    if (token.isCancellationRequested) {
      return;
    }

    // A belt-and-braces fallback: if "ready" never arrives — an old webview, a
    // bundle that failed to attach its listener — send init anyway rather than
    // leaving a blank panel with no diagnosis.
    setTimeout(() => {
      if (!initialised) {
        void sendInit();
      }
    }, 2000);
  }

  /**
   * Answers one webview request.
   *
   * `wiki` calls are forwarded to the repository client by name — the webview's
   * proxy and this dispatch are the whole bridge, which is why adding a method
   * to `WikiRepositoryClient` needs no change on either side.
   */
  private async handleRequest(
    panel: vscode.WebviewPanel,
    request: RpcRequest,
    wikiId: string
  ): Promise<void> {
    try {
      const value = await this.invoke(request, wikiId);
      await post(panel, { type: "response", id: request.id, value });
    } catch (error: unknown) {
      await post(panel, {
        type: "response",
        id: request.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async invoke(request: RpcRequest, wikiId: string): Promise<unknown> {
    switch (request.method) {
      case "wiki": {
        const [methodName, ...args] = request.args as [string, ...unknown[]];
        const client = this.workspace.repositoryClient as unknown as Record<
          string,
          (...callArgs: unknown[]) => Promise<unknown>
        >;
        const method = client[methodName];
        if (typeof method !== "function") {
          throw new Error(`Unknown wiki method: ${methodName}`);
        }

        const result = await method.apply(this.workspace.repositoryClient, args);

        // An editor tab is one page of one wiki, and the wiki picker is off, so
        // offering the window's other wikis here would only let the app pick
        // the wrong one — which it does, since with no picker it just takes the
        // first. Scope the list to this tab's wiki.
        if (methodName === "getWikis") {
          return (result as { id: string }[]).filter((entry) => entry.id === wikiId);
        }
        // postMessage to a webview is JSON, so bytes have to be encoded rather
        // than arriving as an empty object.
        return BINARY_WIKI_METHODS.has(methodName)
          ? Buffer.from(result as ArrayBuffer).toString("base64")
          : result;
      }

      case "search": {
        const [searchWikiId, query] = request.args as [string, string];
        return await this.workspace.search(searchWikiId, query);
      }

      case "alert": {
        await vscode.window.showWarningMessage(String(request.args[0]), { modal: true });
        return undefined;
      }

      case "confirm": {
        // Modal, because every caller is a destructive-or-lossy confirmation
        // (discard edits, delete a page) where a dismissable toast would be
        // read as "yes" by a user who never saw it.
        const answer = await vscode.window.showWarningMessage(
          String(request.args[0]),
          { modal: true },
          "Yes"
        );
        return answer === "Yes";
      }

      case "prompt": {
        return await vscode.window.showInputBox({
          prompt: String(request.args[0]),
          value: request.args[1] === undefined ? undefined : String(request.args[1])
        });
      }

      case "saveFile": {
        const [fileName, base64] = request.args as [string, string];
        const target = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.joinPath(defaultSaveFolder(wikiId), fileName),
          saveLabel: "Export"
        });
        if (!target) {
          return undefined;
        }

        await vscode.workspace.fs.writeFile(target, Buffer.from(base64, "base64"));
        void vscode.window
          .showInformationMessage(`Exported ${path.basename(target.fsPath)}.`, "Open")
          .then((answer) => {
            if (answer === "Open") {
              void vscode.env.openExternal(target);
            }
          });
        return undefined;
      }

      case "openExternal": {
        await vscode.env.openExternal(vscode.Uri.parse(String(request.args[0])));
        return undefined;
      }

      case "openPage": {
        await this.openPage(wikiId, String(request.args[0]));
        return undefined;
      }

      default:
        throw new Error(`Unknown method: ${String(request.method)}`);
    }
  }

  /**
   * Opens another page of the same wiki, following a link.
   *
   * Browsing, so it reuses the preview tab rather than leaving a trail of
   * permanent ones — and reveals the page if it is already open somewhere.
   */
  private async openPage(wikiId: string, pagePath: string): Promise<void> {
    const target = vscode.Uri.file(path.join(wikiId, `${pagePathToRelativePath(pagePath)}.md`));

    if (await openWikiPage(target)) {
      await closeTextTabsFor(target);
      return;
    }

    void vscode.window.showWarningMessage(`PowerWiki could not open ${pagePath}.`);
  }

  private buildHtml(webview: vscode.Webview): string {
    const distUri = vscode.Uri.joinPath(this.context.extensionUri, "dist");
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, "powerwiki-vscode.js"));
    const nonce = createNonce();

    // Monaco, Mermaid and KaTeX all inject styles at runtime, and Mermaid's
    // bundled build evaluates generated code — hence 'unsafe-inline' for styles
    // and 'unsafe-eval' for scripts. Everything else stays locked to this
    // webview's own origin.
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data: blob:`,
      `font-src ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-eval'`,
      `connect-src ${webview.cspSource} data: blob:`,
      `frame-src ${webview.cspSource} https://embed.diagrams.net`
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PowerWiki</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
  </body>
</html>`;
  }
}

/** Where the save dialog starts: beside the wiki, which is where exports belong. */
function defaultSaveFolder(wikiId: string): vscode.Uri {
  const [firstFolder] = vscode.workspace.workspaceFolders ?? [];
  return vscode.Uri.file(path.dirname(wikiId)) ?? firstFolder?.uri;
}

function buildContext(wikiName: string): WikiHostContext {
  return {
    organizationIsHosted: false,
    projectName: wikiName,
    // There is no signed-in identity off a clone. The Git author would be a
    // guess about who is reading, so this says what is actually known.
    userDisplayName: "Local"
  };
}

async function post(panel: vscode.WebviewPanel, message: ExtensionMessage): Promise<void> {
  try {
    await panel.webview.postMessage(message);
  } catch {
    // The panel was disposed between the check and the post; nothing to do.
  }
}

function createNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return nonce;
}

function notAWikiPageHtml(uri: vscode.Uri): string {
  const name = escapeHtml(path.basename(uri.fsPath));
  return `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8" /></head>
  <body style="font-family: var(--vscode-font-family); padding: 24px;">
    <h2>Not a wiki page</h2>
    <p><code>${name}</code> is not inside a wiki PowerWiki recognises.</p>
    <p>Open it as Markdown, or point <code>powerwiki.wikiRoots</code> at the wiki folder.</p>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
