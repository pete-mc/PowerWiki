// Loads the Monaco editor from the extension's bundled AMD build (dist/vs).
// Shared by the Markdown editor and the page-history diff viewer, so Monaco is
// fetched once regardless of which surface needs it first.

import type * as Monaco from "monaco-editor";

export type MonacoApi = typeof Monaco;

interface MonacoAmdRequire {
  (dependencies: readonly string[], onLoad: () => void, onError?: (error: unknown) => void): void;
  config(options: { paths: { vs: string } }): void;
}

declare global {
  interface Window {
    monaco?: MonacoApi;
    require?: MonacoAmdRequire;
  }
}

let monacoLoadPromise: Promise<MonacoApi> | undefined;

/**
 * Where Monaco's AMD build lives, as a URL prefix without a trailing slash.
 *
 * The hub serves it from the bundle's own folder, so a relative path works
 * there. A VS Code webview has an opaque origin and resolves nothing relative,
 * so it has to be told the `vscode-resource` URI instead.
 */
let monacoBaseUrl = "vs";

export function setMonacoBaseUrl(baseUrl: string): void {
  monacoBaseUrl = baseUrl.replace(/\/+$/, "");
}

export function loadMonaco(): Promise<MonacoApi> {
  if (window.monaco) {
    return Promise.resolve(window.monaco);
  }

  monacoLoadPromise ??= new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>("script[data-powerwiki-monaco-loader='true']");
    if (existingScript && typeof window.require === "function") {
      configureAndLoadMonaco(resolve, reject);
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.dataset.powerwikiMonacoLoader = "true";
    script.src = `${monacoBaseUrl}/loader.js`;
    script.onload = () => configureAndLoadMonaco(resolve, reject);
    script.onerror = () => reject(new Error("Unable to load Monaco editor assets."));
    document.head.appendChild(script);
  });

  return monacoLoadPromise;
}

function configureAndLoadMonaco(resolve: (monaco: MonacoApi) => void, reject: (error: unknown) => void): void {
  if (!window.require) {
    reject(new Error("Monaco loader did not initialize."));
    return;
  }

  window.require.config({ paths: { vs: monacoBaseUrl } });
  window.require(["vs/editor/editor.main"], () => {
    if (window.monaco) {
      resolve(window.monaco);
      return;
    }

    reject(new Error("Monaco editor did not initialize."));
  }, reject);
}

export function formatEditorLoadError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to load Monaco editor.";
}
