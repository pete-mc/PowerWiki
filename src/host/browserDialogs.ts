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
