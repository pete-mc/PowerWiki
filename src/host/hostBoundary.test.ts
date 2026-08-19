// The rule that lets one UI serve two extensions, enforced.
//
// PowerWiki ships as an Azure DevOps hub extension and as a VS Code extension,
// and they share every line of UI. That is only true while the shared layers
// import nothing host-specific: the moment a component reaches for
// `azure-devops-extension-sdk`, it stops working in VS Code, and the moment one
// reaches for `vscode`, it stops working in the hub — and either way the failure
// shows up as a broken extension for half the users, not as a compile error.
//
// AGENTS.md states the rule ("Two hosts, one UI"). Nothing checked it. A rule
// that only exists in prose survives exactly as long as everyone who reads it
// remembers it, so this is the check.

import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.resolve(__dirname, "..");

/** Layers that must run unchanged in both hosts. */
const SHARED_LAYERS = ["app", "rendering", "export", "drawio", "wiki", "identity", "workItems"];

/**
 * Host SDKs, and where each is allowed to be imported.
 *
 * Everything else in the repository is free to use them; these are the layers
 * that are not.
 */
const HOST_SDKS = [
  { module: "azure-devops-extension-sdk", host: "Azure DevOps" },
  { module: "azure-devops-extension-api", host: "Azure DevOps" },
  { module: "vscode", host: "VS Code" }
];

/**
 * The exceptions, named individually rather than by pattern.
 *
 * These *are* the Azure DevOps client layer — the thing the interface exists to
 * abstract — so they import the SDK by definition. Listing them explicitly means
 * a new file cannot join them by accident: it has to be added here, which is a
 * decision someone makes rather than one that happens.
 */
const ALLOWED = new Set([
  "wiki/AzureDevOpsWikiRepositoryClient.ts",
  "wiki/attachmentImage.ts",
  "wiki/followClient.ts",
  "wiki/wikiSearch.ts",
  "wiki/wikiSearchTransport.ts",
  "identity/AzureDevOpsIdentityClient.ts",
  "workItems/AzureDevOpsWorkItemClient.ts"
]);

describe("the host boundary", () => {
  const offenders = sharedLayerFiles().flatMap((file) => {
    const relative = path.relative(SOURCE_ROOT, file).split(path.sep).join("/");
    if (ALLOWED.has(relative)) {
      return [];
    }

    const source = readFileSync(file, "utf8");
    return HOST_SDKS.filter(({ module }) => importsModule(source, module)).map(
      ({ module, host }) => `${relative} imports ${module} (${host}-only)`
    );
  });

  it("keeps host SDKs out of the layers both extensions share", () => {
    expect(offenders).toEqual([]);
  });

  // A guard whose exception list has quietly become the whole codebase is not a
  // guard. This fails if an entry is deleted or renamed without updating it.
  it("has an exception list that is still accurate", () => {
    const stale = [...ALLOWED].filter((relative) => {
      try {
        return !statSync(path.join(SOURCE_ROOT, relative)).isFile();
      } catch {
        return true;
      }
    });

    expect(stale).toEqual([]);
  });

  // The sandbox is the third host, and it exists to run the UI with no host SDK
  // at all. If it needed one, the boundary would not be where it claims to be.
  it("keeps host SDKs out of the sandbox", () => {
    const sandboxOffenders = filesUnder(path.join(SOURCE_ROOT, "sandbox")).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return HOST_SDKS.filter(({ module }) => importsModule(source, module)).map(
        ({ module }) => `${path.relative(SOURCE_ROOT, file)} imports ${module}`
      );
    });

    expect(sandboxOffenders).toEqual([]);
  });

  // The other direction: the VS Code host is free to import `vscode`, but the
  // half of it that runs inside the webview is a browser bundle, where the
  // module does not exist at all. Importing it there is a runtime crash on load.
  it("keeps the vscode module out of the webview bundle", () => {
    const webviewOffenders = filesUnder(path.join(SOURCE_ROOT, "vscode", "webview")).flatMap(
      (file) => {
        const source = readFileSync(file, "utf8");
        return importsModule(source, "vscode")
          ? [`${path.relative(SOURCE_ROOT, file)} imports vscode`]
          : [];
      }
    );

    expect(webviewOffenders).toEqual([]);
  });
});

function sharedLayerFiles(): string[] {
  return SHARED_LAYERS.flatMap((layer) => filesUnder(path.join(SOURCE_ROOT, layer)));
}

function filesUnder(directory: string): string[] {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return filesUnder(full);
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
      return [];
    }
    return [full];
  });
}

/**
 * Whether a source file imports a module.
 *
 * Matches `import ... from "m"`, `import "m"`, `require("m")` and
 * `import("m")`, including submodule paths such as
 * `azure-devops-extension-api/WorkItemTracking`.
 *
 * `import type` is deliberately **not** matched: a type-only import is erased at
 * build time, imports no code, and is how the shared layers legitimately refer
 * to a host client's return shape. Flagging it would push people towards
 * duplicating those types, which is worse.
 */
function importsModule(source: string, module: string): boolean {
  const escaped = module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const specifier = `["'](?:${escaped})(?:/[^"']*)?["']`;
  const patterns = [
    new RegExp(`import\\s+(?!type\\b)[^;'"]*from\\s+${specifier}`),
    new RegExp(`import\\s+${specifier}`),
    new RegExp(`require\\(\\s*${specifier}\\s*\\)`),
    new RegExp(`import\\(\\s*${specifier}\\s*\\)`)
  ];

  return patterns.some((pattern) => pattern.test(source));
}
