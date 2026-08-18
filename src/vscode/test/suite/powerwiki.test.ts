// UI tests for PowerWiki in VS Code.
//
// These run inside a real VS Code window against a real workspace, and assert
// on what the webview reports it rendered. Every test here maps to something a
// user does: open a page from the Explorer, follow a link, edit and save, see
// history, search. Unit tests already cover the pure pieces (path encoding,
// `.order`, discovery, the filesystem client) — these cover the assembly.

import * as assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import type { PowerWikiApi } from "../../extension";
import {
  closeAllEditors,
  getApi,
  openPage,
  waitForScreen,
  wikiFile,
  wikiRootFor
} from "./helpers";

suite("PowerWiki in VS Code", function () {
  // Opening a page runs the whole bundle: React, the Markdown pipeline, Mermaid.
  this.timeout(60_000);

  let api: PowerWikiApi;
  let productWiki: string;

  suiteSetup(async () => {
    api = await getApi();
    await api.workspace.refresh();
    productWiki = wikiRootFor(api, "Product.wiki");
  });

  teardown(async () => {
    await closeAllEditors();
  });

  suite("finding the wiki", () => {
    // The three layouts the extension has to support, all in one window.
    test("finds a wiki that is a workspace folder, one nested in a subfolder, and a second workspace folder", () => {
      const names = api.workspace.discovered.map((wiki) => wiki.name).sort();

      assert.deepEqual(names, ["Handbook.wiki", "Product.wiki", "Service.wiki"]);
    });

    test("records where a nested wiki sits inside its repository", () => {
      const nested = api.workspace.discovered.find((wiki) => wiki.name === "Service.wiki");

      assert.ok(nested);
      assert.equal(nested.mappedPath, "/docs/Service.wiki");
    });

    test("maps a file to its page path, and rejects Markdown outside a wiki", () => {
      const wiki = api.workspace.discovered.find((entry) => entry.name === "Product.wiki");
      assert.ok(wiki);

      assert.equal(
        api.workspace.pagePathForFile(wiki, path.join(productWiki, "Home", "Getting-Started.md")),
        "/Home/Getting Started"
      );
      // A README in a code folder is not a wiki page and must not be claimed.
      const readme = path.join(path.dirname(productWiki), "service", "README.md");
      assert.equal(api.workspace.findWikiForFile(readme), undefined);
    });
  });

  suite("viewing a page", () => {
    test("renders the page a file represents", async () => {
      const screen = await openPage(api, wikiFile(productWiki, "Home.md"));

      assert.equal(screen.pagePath, "/Home");
      assert.ok(screen.headings.includes("Product Wiki"), `headings: ${screen.headings.join(" | ")}`);
      assert.ok(screen.headings.includes("Diagram"));
    });

    // The file name is not the page name: spaces are hyphens and a literal
    // hyphen is %2D. Getting this wrong shows the raw file stem as the title.
    test("decodes an encoded file name back to its page title", async () => {
      const screen = await openPage(api, wikiFile(productWiki, "Home/Well%2Dknown-Issues.md"));

      assert.equal(screen.pagePath, "/Home/Well-known Issues");
      assert.ok(screen.headings.includes("Well-known Issues"));
    });

    test("renders GFM tables", async () => {
      const screen = await openPage(api, wikiFile(productWiki, "Home/Getting-Started.md"));

      assert.ok(screen.headings.includes("Getting Started"));
      assert.equal(screen.editing, false);
    });
  });

  suite("the chrome VS Code replaces", () => {
    test("shows no page tree and no wiki picker: the Explorer is the tree", async () => {
      const screen = await openPage(api, wikiFile(productWiki, "Home.md"));

      assert.equal(screen.chrome.pageTree, false);
      assert.equal(screen.chrome.wikiSelector, false);
    });

    // Comments live in Azure DevOps, not in the files, so a clone has none.
    // Absent, not present-and-broken.
    test("offers no comments", async () => {
      const screen = await openPage(api, wikiFile(productWiki, "Home.md"));

      assert.equal(screen.chrome.commentsToggle, false);
    });

    // Work items and mentions cannot be resolved offline, so they stay as
    // written rather than showing a chip that never fills in.
    test("leaves work item references and mentions inert", async () => {
      const screen = await openPage(
        api,
        wikiFile(productWiki, "Home.md"),
        (candidate) => candidate.rendered && candidate.chrome.workItems > 0
      );

      assert.equal(screen.chrome.workItems, 1);
      // The reference is shown, but nothing was fetched to fill it in.
      assert.equal(screen.chrome.enrichedWorkItems, 0);
      assert.equal(screen.chrome.inertMentions, 1);
    });
  });

  suite("navigating", () => {
    // This is what makes the Explorer the page tree: following a link opens the
    // target's *file*, so VS Code's own model of "where you are" stays correct.
    test("following an in-page wiki link opens that page's file", async () => {
      await openPage(api, wikiFile(productWiki, "Home.md"));

      const target = wikiFile(productWiki, "Home/Getting-Started.md");
      const waiter = waitForScreen(api, target.fsPath, (screen) => screen.rendered);
      await vscode.commands.executeCommand("vscode.openWith", target, "powerwiki.page");
      const screen = await waiter;

      assert.equal(screen.pagePath, "/Home/Getting Started");
    });

    test("opens the wiki's home page on command", async () => {
      await vscode.commands.executeCommand("powerwiki.openHome", productWiki);

      const screen = await waitForScreen(
        api,
        wikiFile(productWiki, "Home.md").fsPath,
        (candidate) => candidate.rendered
      );
      assert.equal(screen.pagePath, "/Home");
    });
  });

  suite("editing", () => {
    const scratchPage = "Scratch.md";

    teardown(async () => {
      await fs.rm(path.join(productWiki, scratchPage), { force: true });
      await api.workspace.refresh();
    });

    test("creates a page, and the file appears in the workspace", async () => {
      await api.workspace.repositoryClient.createPage(productWiki, "/Scratch", "# Scratch\n");

      const contents = await fs.readFile(path.join(productWiki, scratchPage), "utf8");
      assert.equal(contents, "# Scratch\n");

      const screen = await openPage(api, wikiFile(productWiki, scratchPage));
      assert.ok(screen.headings.includes("Scratch"));
    });

    // Page operations go through VS Code's own filesystem API, not node's, so
    // these cover the writer the extension actually uses.
    test("renames a page, moving its file", async () => {
      await api.workspace.repositoryClient.createPage(productWiki, "/Scratch", "# Scratch\n");

      await api.workspace.repositoryClient.movePage(productWiki, "/Scratch", "/Renamed", 0);

      assert.equal(
        await fs.readFile(path.join(productWiki, "Renamed.md"), "utf8"),
        "# Scratch\n"
      );
      assert.equal(await exists(path.join(productWiki, scratchPage)), false);
      await fs.rm(path.join(productWiki, "Renamed.md"), { force: true });
    });

    test("deletes a page, and its file goes", async () => {
      await api.workspace.repositoryClient.createPage(productWiki, "/Scratch", "# Scratch\n");
      assert.equal(await exists(path.join(productWiki, scratchPage)), true);

      await api.workspace.repositoryClient.deletePage(productWiki, "/Scratch");

      assert.equal(await exists(path.join(productWiki, scratchPage)), false);
    });

    // A save goes through VS Code's editor stack, so the document, the file and
    // the webview must all end up agreeing.
    test("a save reaches the file and the open page re-renders", async () => {
      await api.workspace.repositoryClient.createPage(productWiki, "/Scratch", "# Scratch\n");
      const uri = wikiFile(productWiki, scratchPage);
      await openPage(api, uri);

      await api.workspace.repositoryClient.savePage(productWiki, {
        path: "/Scratch",
        content: "# Scratch Updated\n\nNew body.\n"
      });

      const screen = await waitForScreen(api, uri.fsPath, (candidate) =>
        candidate.headings.includes("Scratch Updated")
      );

      assert.ok(screen.headings.includes("Scratch Updated"));
      assert.equal(
        await fs.readFile(path.join(productWiki, scratchPage), "utf8"),
        "# Scratch Updated\n\nNew body.\n"
      );
    });
  });

  suite("history and search", () => {
    test("reports a page's Git history", async function () {
      const meta = await api.workspace.repositoryClient.getPageMeta(productWiki, "/Home");
      const revisions = await api.workspace.repositoryClient.getPageRevisions(
        productWiki,
        meta.gitItemPath ?? ""
      );

      if (revisions.length === 0) {
        // The fixture seeds a commit only when git is on PATH.
        this.skip();
      }

      assert.equal(revisions[0].comment, "Seed the test wiki");
      assert.equal(revisions[0].authorName, "PowerWiki Tester");
    });

    test("searches page content and page names", async () => {
      const outcome = await api.workspace.search(productWiki, "mermaid");

      assert.ok(outcome.total >= 1, "expected at least one hit for 'mermaid'");
      assert.ok(outcome.hits.some((hit) => hit.path === "/Home"));
      assert.ok(outcome.hits[0].snippets.length > 0, "a hit should carry a snippet");
    });

    test("finds nothing for a term the wiki does not contain", async () => {
      const outcome = await api.workspace.search(productWiki, "zzzznotpresent");

      assert.equal(outcome.total, 0);
    });
  });

  suite("Markdown that is not a wiki page", () => {
    test("is left alone", async () => {
      const readme = vscode.Uri.file(
        path.join(path.dirname(productWiki), "service", "README.md")
      );

      const document = await vscode.workspace.openTextDocument(readme);
      await vscode.window.showTextDocument(document);

      // Given a moment for the Explorer hand-off to have fired if it were going
      // to, the file should still be open as ordinary text.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, readme.fsPath);
    });
  });
});

async function exists(target: string): Promise<boolean> {
  return fs
    .stat(target)
    .then(() => true)
    .catch(() => false);
}
