// WikiHostDialogs backed by the browser's own modals.
//
// Correct wherever the page is allowed to open them — the Azure DevOps hub and
// the local sandbox. A VS Code webview is not such a place (its iframe has no
// `allow-modals`), which is why this is a host member rather than a direct call.

import type { WikiHostDialogs } from "./WikiHost";

export const browserDialogs: WikiHostDialogs = {
  alert(message) {
    window.alert(message);
    return Promise.resolve();
  },
  confirm(message) {
    return Promise.resolve(window.confirm(message));
  },
  prompt(message, defaultValue) {
    return Promise.resolve(window.prompt(message, defaultValue) ?? undefined);
  }
};

/**
 * Hands a generated file to the browser. Works wherever a page is allowed to
 * start a download — the hub and the sandbox, but not a VS Code webview.
 */
export function downloadInBrowser(fileName: string, blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on a later tick: revoking synchronously can cancel the download
  // before the browser has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return Promise.resolve();
}
