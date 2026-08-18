// The workspace the UI tests run against.
//
// Built on disk rather than committed, because the point is to cover all three
// layouts the extension has to handle in one window — a wiki that *is* a
// workspace folder, a wiki in a subfolder, and a wiki in a second workspace
// folder — and a committed fixture would only ever be one of them.

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface TestWorkspace {
  readonly rootPath: string;
  /** Workspace folder that *is* a wiki clone. */
  readonly directWikiPath: string;
  /** Workspace folder holding code, with a wiki nested inside it. */
  readonly codeFolderPath: string;
  readonly nestedWikiPath: string;
  /** A second workspace folder that is a wiki. */
  readonly secondWikiPath: string;
  /** The .code-workspace file listing all three folders. */
  readonly workspaceFilePath: string;
}

export async function createTestWorkspace(): Promise<TestWorkspace> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "powerwiki-vscode-test-"));

  const directWikiPath = path.join(rootPath, "Product.wiki");
  const codeFolderPath = path.join(rootPath, "service");
  const nestedWikiPath = path.join(codeFolderPath, "docs", "Service.wiki");
  const secondWikiPath = path.join(rootPath, "Handbook.wiki");

  await buildMainWiki(directWikiPath);
  await buildNestedWiki(nestedWikiPath);
  await buildSimpleWiki(secondWikiPath, "Handbook");

  await fs.mkdir(path.join(codeFolderPath, "src"), { recursive: true });
  await fs.writeFile(path.join(codeFolderPath, "src", "index.ts"), "export const x = 1;\n");
  // A Markdown file that is *not* in a wiki, so the tests can prove PowerWiki
  // leaves ordinary Markdown alone.
  await fs.writeFile(path.join(codeFolderPath, "README.md"), "# Service\n\nNot a wiki page.\n");

  const workspaceFilePath = path.join(rootPath, "powerwiki.code-workspace");
  await fs.writeFile(
    workspaceFilePath,
    `${JSON.stringify(
      {
        folders: [{ path: "Product.wiki" }, { path: "service" }, { path: "Handbook.wiki" }],
        settings: {
          "powerwiki.discoveryDepth": 3,
          "workbench.startupEditor": "none",
          "security.workspace.trust.enabled": false
        }
      },
      undefined,
      2
    )}\n`
  );

  return {
    rootPath,
    directWikiPath,
    codeFolderPath,
    nestedWikiPath,
    secondWikiPath,
    workspaceFilePath
  };
}

/** The wiki most assertions run against: real content, real history, real links. */
async function buildMainWiki(wikiPath: string): Promise<void> {
  await write(wikiPath, "Home.md", HOME_PAGE);
  await write(wikiPath, "Home/Getting-Started.md", GETTING_STARTED_PAGE);
  await write(wikiPath, "Home/Well%2Dknown-Issues.md", "# Well-known Issues\n\nNothing yet.\n");
  await write(wikiPath, "Release-Notes.md", "# Release Notes\n\nMermaid lives on the home page.\n");
  await write(wikiPath, ".order", "Home\nRelease-Notes\n");
  await write(wikiPath, "Home/.order", "Getting-Started\nWell%2Dknown-Issues\n");
  await fs.mkdir(path.join(wikiPath, ".attachments"), { recursive: true });

  // A committed history, so "History" has something to show and the page's
  // byline can name an author.
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: wikiPath, stdio: "pipe", encoding: "utf8" });
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.email", "tester@example.com");
    git("config", "user.name", "PowerWiki Tester");
    git("add", ".");
    git("commit", "--quiet", "-m", "Seed the test wiki");
  } catch {
    // Git missing only costs the history assertions; everything else still runs.
  }
}

async function buildNestedWiki(wikiPath: string): Promise<void> {
  await write(wikiPath, "Home.md", "# Service Wiki\n\nNested inside a code repository.\n");
  await write(wikiPath, ".order", "Home\n");
}

async function buildSimpleWiki(wikiPath: string, title: string): Promise<void> {
  await write(wikiPath, "Home.md", `# ${title}\n\nA second wiki in the same window.\n`);
  await write(wikiPath, ".order", "Home\n");
}

async function write(wikiPath: string, relativePath: string, contents: string): Promise<void> {
  const target = path.join(wikiPath, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents, "utf8");
}

// Exercises the parts of the pipeline that have to keep working off a clone:
// GFM, a Mermaid diagram, a wiki link, and the two things that must render
// inert without Azure DevOps — a work item reference and an @mention.
const HOME_PAGE = `# Product Wiki

Welcome to the **test** wiki.

- [Getting Started](/Home/Getting-Started)
- [Well-known Issues](/Home/Well-known-Issues)

## Diagram

\`\`\`mermaid
graph TD
  A[Clone] --> B[Open in VS Code]
\`\`\`

## References

Tracked as #1234 by @<11111111-1111-1111-1111-111111111111>.
`;

const GETTING_STARTED_PAGE = `# Getting Started

Clone the wiki repository and open the folder in VS Code.

| Step | What happens |
| --- | --- |
| 1 | The Explorer lists the pages |
| 2 | Opening one renders it here |
`;
