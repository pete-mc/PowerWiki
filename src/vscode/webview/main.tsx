// Webview entry point for the VS Code host.
//
// Compare with `src/extension/main.tsx` (the hub) and `src/sandbox/main.tsx`:
// all three build a `WikiHost` and render the same `App`. That is the entire
// per-host cost of the UI.

import { useEffect } from "react";
import { createRoot } from "react-dom/client";

import { App } from "../../app/App";
import { setMonacoBaseUrl } from "../../app/wiki/monacoLoader";
import { ErrorBoundary } from "../../app/ErrorBoundary";
import type { InitMessage } from "../protocol";
import { ExtensionBridge } from "./rpcClient";
import { VsCodeWikiHost } from "./VsCodeWikiHost";

import "../../app/styles.css";
import "./vscodeTheme.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("PowerWiki root element was not found.");
}

const bridge = new ExtensionBridge();
const root = createRoot(rootElement);

root.render(
  <ErrorBoundary label="PowerWiki">
    <App status="loading" />
  </ErrorBoundary>
);

bridge.onMessage((message) => {
  if (message.type === "init") {
    mount(message);
    return;
  }

  if (message.type === "reload") {
    // The file changed outside PowerWiki. The extension only sends this when no
    // edit is in progress (it watches the state messages below), so nothing
    // unsaved is lost.
    window.location.reload();
  }
});

function mount(init: InitMessage): void {
  document.documentElement.classList.add("powerwiki-vscode-root");
  setMonacoBaseUrl(init.monacoBaseUrl);
  const host = new VsCodeWikiHost(bridge, init);

  root.render(
    <ErrorBoundary label="PowerWiki">
      <ScreenReporter />
      <App host={host} logoUrl={init.logoUrl} status="ready" />
    </ErrorBoundary>
  );
}

/**
 * Reports what the webview is showing back to the extension host.
 *
 * Two callers, both of which need it: the extension suppresses an external-file
 * reload while an edit is in progress, and the UI tests assert on this rather
 * than on webview DOM — an extension-host test process cannot reach inside a
 * webview, so the rendered result has to be reported out to be observed at all.
 *
 * It reads the real rendered DOM rather than component state on purpose: a test
 * that asserts "the heading rendered" should fail if rendering breaks, not pass
 * because a state field was set.
 */
function ScreenReporter() {
  useEffect(() => {
    const shell = document.querySelector(".powerwiki-shell");
    if (!shell) {
      return;
    }

    // Adding the class here rather than in the shared component keeps the
    // VS Code-only header trimming out of the hub's markup.
    shell.classList.add("powerwiki-vscode");

    let lastPayload = "";
    const report = () => {
      const content = document.querySelector(".powerwiki-content");
      const headings = [...(content?.querySelectorAll("h1, h2, h3, h4, h5, h6") ?? [])]
        .map((heading) => heading.textContent?.trim() ?? "")
        .filter(Boolean);

      const payload = {
        editing: Boolean(document.querySelector(".wiki-editor-shell")),
        headings,
        pagePath: document.querySelector<HTMLElement>("[data-powerwiki-page-path]")?.dataset
          .powerwikiPagePath,
        title: document.querySelector(".powerwiki-header-title h1")?.textContent ?? undefined,
        rendered: Boolean(content?.querySelector(".markdown-preview")),
        error: document.querySelector('[role="alert"]')?.textContent ?? undefined,
        chrome: {
          pageTree: Boolean(document.querySelector(".powerwiki-nav-tree")),
          wikiSelector: Boolean(document.querySelector(".wiki-selector")),
          commentsToggle: Boolean(document.querySelector(".wiki-byline-comments")),
          // A badge that never gained the "-rich" class was never enriched,
          // which off a clone is the intended outcome, not a failure.
          inertWorkItems: document.querySelectorAll(
            ".powerwiki-work-item-badge:not(.powerwiki-work-item-badge-rich)"
          ).length,
          inertMentions: document.querySelectorAll(".powerwiki-mention-unresolved").length
        }
      };

      const serialized = JSON.stringify(payload);
      if (serialized !== lastPayload) {
        lastPayload = serialized;
        bridge.postState(payload);
      }
    };

    report();
    const observer = new MutationObserver(report);
    observer.observe(shell, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
