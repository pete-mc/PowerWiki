// Launches VS Code with the built extension and runs the UI suite inside it.
//
// Run with `npm run test:vscode`. It downloads a VS Code build on first use
// (cached under .vscode-test/), builds a throwaway multi-root workspace, and
// starts the window with that workspace open.

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { runTests } from "@vscode/test-electron";

import { createTestWorkspace } from "../test/fixtures";

async function main(): Promise<void> {
  // `vscode/` holds the extension manifest; VS Code loads the extension from
  // there, and its `main` points at the bundle the build produced.
  const extensionDevelopmentPath = path.resolve(__dirname, "../..");
  const extensionTestsPath = path.resolve(__dirname, "./suite/index");

  const workspace = await createTestWorkspace();
  const userDataDir = path.join(workspace.rootPath, ".vscode-user");
  await fs.mkdir(userDataDir, { recursive: true });

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspace.workspaceFilePath,
        // A fresh profile per run: a leftover one carries settings and open
        // editors from a previous run, which is exactly the kind of hidden
        // state that makes a UI suite flaky.
        "--user-data-dir",
        userDataDir,
        "--disable-extensions",
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
        // Chromium's sandbox needs privileges a container often lacks; the test
        // window is running our own code either way.
        "--no-sandbox",
        "--disable-gpu"
      ]
    });
  } finally {
    await fs.rm(workspace.rootPath, { force: true, recursive: true }).catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error("PowerWiki VS Code tests failed:", error);
  process.exitCode = 1;
});
