// The VS Code implementation of WikiHost.
//
// Compare it with `src/host/azureDevOpsWikiHost.ts`: same interface, and the
// differences are exactly the ones a local clone forces.
//
//   * no comments, no follow — those are Azure DevOps service state, not files
//   * no work items, no mentions — nothing to resolve them against offline, so
//     they are left undefined and the renderer's own fallback keeps them inert
//   * no page tree, no wiki picker — the VS Code Explorer is the tree, and the
//     editor tab has already chosen the wiki
//   * search is a local scan rather than a service call
//   * navigation is the editor: "set the hash" means "open that page's file"

import type {
  WikiHost,
  WikiHostContext,
  WikiHostDialogs,
  WikiHostNavigation
} from "../../host/WikiHost";
import { joinRepositoryPath } from "../../wiki/repositoryItemPath";
import type { WikiSummary } from "../../wiki/WikiPage";
import type { WikiRepositoryClient } from "../../wiki/WikiRepositoryClient";
import type { WikiSearchOutcome } from "../../wiki/wikiSearch";
import type { InitMessage } from "../protocol";
import { VS_CODE_CAPABILITIES } from "../capabilities";
import type { ExtensionBridge } from "./rpcClient";

export class VsCodeWikiHost implements WikiHost {
  public readonly capabilities = VS_CODE_CAPABILITIES;


  public readonly context: WikiHostContext;
  public readonly wikiClient: WikiRepositoryClient;
  public readonly dialogs: WikiHostDialogs;

  private readonly navigation: VsCodeNavigation;

  public constructor(
    private readonly bridge: ExtensionBridge,
    private readonly init: InitMessage
  ) {
    this.context = init.context;
    this.wikiClient = bridge.createWikiClient();
    this.navigation = new VsCodeNavigation(bridge, init.activePagePath);

    this.dialogs = {
      alert: (message) => bridge.call<void>("alert", message),
      confirm: (message) => bridge.call<boolean>("confirm", message),
      prompt: (message, defaultValue) => bridge.call<string | undefined>("prompt", message, defaultValue)
    };
  }

  public searchContent = (searchText: string): Promise<WikiSearchOutcome> =>
    this.bridge.call<WikiSearchOutcome>("search", this.init.activeWikiId, searchText);

  public getNavigation(): Promise<WikiHostNavigation | undefined> {
    return Promise.resolve(this.navigation);
  }

  /**
   * Attachments are plain files here, so there is nothing to fetch: the URL the
   * preview was given is already a webview URI VS Code will serve. The hub has
   * to download the bytes with an access token because a bare cross-origin
   * `<img src>` at the Items API gets redirected to a sign-in page.
   */
  public loadImageObjectUrl(url: string): Promise<string> {
    return Promise.resolve(url);
  }

  /**
   * draw.io needs the image as a data URL — its editor runs in a different
   * origin and cannot resolve a URI minted for this webview.
   */
  public async loadImageDataUrl(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not read the diagram: ${response.status}`);
    }

    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Unable to read the attachment."));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * A webview cannot start a download, so the bytes go to the extension host,
   * which asks where to put them and writes the file.
   */
  public async saveExportedFile(fileName: string, blob: Blob): Promise<void> {
    const base64 = arrayBufferToBase64(await blob.arrayBuffer());
    await this.bridge.call<void>("saveFile", fileName, base64);
  }

  public openExternal(url: string): void {
    void this.bridge.call<void>("openExternal", url);
  }

  /** No shareable URL for a local file; headings keep their in-page anchor. */
  public buildPageUrl(): string | undefined {
    return undefined;
  }

  public buildAttachmentUrl(wiki: WikiSummary, wikiPath: string): string | undefined {
    const repositoryPath = joinRepositoryPath(wiki.mappedPath, wikiPath);
    return `${this.init.attachmentBaseUrl}${repositoryPath.replace(/^\//, "")}`;
  }
}

/**
 * Routing, VS Code style.
 *
 * There is no address bar, so the "hash" is which page this editor tab shows.
 * That turns out to fit the app's existing navigation service exactly: asking
 * the host for the current hash returns this tab's page, and setting it means
 * "open that page" — which VS Code answers by opening the file, so an in-page
 * wiki link lands in the Explorer's own model of where you are rather than in a
 * history stack PowerWiki would otherwise have to keep in parallel.
 */
class VsCodeNavigation implements WikiHostNavigation {
  private readonly listeners = new Set<(hash: string) => void>();

  public constructor(
    private readonly bridge: ExtensionBridge,
    private currentPagePath: string
  ) {
    bridge.onMessage((message) => {
      if (message.type === "navigate") {
        this.currentPagePath = message.pagePath;
        for (const listener of this.listeners) {
          listener(toHash(message.pagePath));
        }
      }
    });
  }

  public getHash(): Promise<string> {
    return Promise.resolve(toHash(this.currentPagePath));
  }

  public setHash(hash: string): Promise<void> {
    const pagePath = fromHash(hash);
    if (pagePath === this.currentPagePath) {
      // The app reflects its own navigation back to the host; opening the file
      // we are already showing would steal focus for nothing.
      return Promise.resolve();
    }

    return this.bridge.call<void>("openPage", pagePath);
  }

  public onHashChanged(callback: (hash: string) => void): void {
    this.listeners.add(callback);
  }

  /** VS Code names the tab after the file; the app's title would fight it. */
  public setDocumentTitle(): void {}
}

function toHash(pagePath: string): string {
  return encodeURI(pagePath.startsWith("/") ? pagePath : `/${pagePath}`);
}

function fromHash(hash: string): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  // Strip the "&anchor=" marker the app appends for heading deep links: the
  // scroll happens in-page, and it is not part of the file's identity.
  const withoutAnchor = raw.split("&anchor=")[0];
  try {
    return decodeURIComponent(withoutAnchor);
  } catch {
    return withoutAnchor;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunked because String.fromCharCode(...bytes) blows the argument limit on
  // anything larger than a small document.
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
