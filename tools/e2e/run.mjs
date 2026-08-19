// End-to-end UI tests for the Azure DevOps side of PowerWiki.
//
//   npm run test:e2e
//
// What this is, and why it is not `tools/pw/`:
//
// `tools/pw/verify.mjs` drives a *published* build inside real Azure DevOps. It
// is the right tool for REST-contract drift and host-service behaviour, but it
// needs an interactive sign-in (`npm run pw:auth`), it cannot run unattended in
// CI, and it tests the last release rather than the working tree. So the branch
// of the product that actually changes most — the shell, the tree, rendering,
// the editors, search, export — had no end-to-end coverage at all.
//
// This drives the real application in a real browser against the local sandbox
// (`src/sandbox/`), which mounts the same `App` the hub mounts, behind the same
// `WikiHost` interface, with an in-memory wiki instead of REST. Everything above
// the host boundary is therefore the production code path. What it deliberately
// cannot catch is anything *below* that boundary — REST contracts, permissions,
// the extension SDK handshake — which is what the layered testing in AGENTS.md
// says to use the dev extension and the canary for.
//
// Assertions are on rendered DOM, never on internal state: the point is to fail
// when a user would see something wrong.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARTIFACTS = path.join(REPO_ROOT, "tools", "e2e", "artifacts");
const PORT = Number(process.env.PW_E2E_PORT ?? 3123);
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.PW_E2E_HEADED !== "1";

const results = [];
let failures = 0;

async function test(name, body) {
  try {
    await body();
    results.push(`  PASS  ${name}`);
  } catch (error) {
    failures += 1;
    results.push(`  FAIL  ${name}\n        ${error.message.split("\n")[0]}`);
  }
}

async function main() {
  if (!fs.existsSync(path.join(REPO_ROOT, "dist", "sandbox.js"))) {
    throw new Error(
      "dist/sandbox.js is missing. The sandbox bundle is only built in development mode — " +
        "run `npm run build:dev` first (test:e2e does this for you)."
    );
  }

  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const server = await startServer();
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  try {
    // A deliberate latency so loading states exist to be caught; see the sandbox.
    await page.goto(`${BASE}/dist/sandbox.html?latency=40`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".powerwiki-shell", { timeout: 30_000 });

    await runSuite(page);

    await test("no uncaught errors were logged while doing all that", () => {
      // Filter the noise a local static server produces (favicon, source maps)
      // from anything the application itself threw.
      const real = consoleErrors.filter(
        (text) => !/favicon|sourcemap|source map|net::ERR_/i.test(text)
      );
      assert(real.length === 0, `console errors: ${real.slice(0, 3).join(" | ")}`);
    });

    await page.screenshot({ path: path.join(ARTIFACTS, "final.png"), fullPage: false });
  } finally {
    await context.close();
    await browser.close();
    server.kill();
  }

  console.log("\nPowerWiki e2e (Azure DevOps UI, via the sandbox)\n");
  console.log(results.join("\n"));
  console.log(`\n${results.length - failures} passing, ${failures} failing\n`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

async function runSuite(page) {
  await test("the shell renders with a page tree and a page", async () => {
    await page.waitForSelector(".powerwiki-nav-tree", { timeout: 15_000 });
    await page.waitForSelector(".markdown-preview", { timeout: 15_000 });
    const pages = await page.locator(".wiki-page-tree-link").count();
    assert(pages > 0, "the tree rendered no pages");
  });

  await test("expanding a parent and clicking a child renders that page", async () => {
    // Expanding is the chevron, not the page link: clicking the link navigates
    // to the parent, which is a different thing a user does.
    await expandTree(page, "Guides");
    await openPage(page, "Diagrams", "/Guides/Diagrams");

    const heading = await page.locator(".markdown-preview h1").first().innerText();
    assert(/Diagrams/i.test(heading), `unexpected heading: ${heading}`);
  });

  // GitHub #29: a link to a page whose title contains a hyphen surrounded by
  // spaces. Azure DevOps stores that title as `List-%2D-Firewall-rules`, and
  // resolving the link used to destroy the `%2D` escape and 404.
  await test("follows a link to a page whose title contains a hyphen (GitHub #29)", async () => {
    await openPage(page, "Guides", "/Guides");

    await page.locator(".markdown-preview a", { hasText: "List - Firewall rules" }).first().click();

    await page.waitForFunction(
      () =>
        document.querySelector(".powerwiki-content")?.getAttribute("data-powerwiki-page-path") ===
        "/Guides/List - Firewall rules",
      undefined,
      { timeout: 20_000 }
    );

    const heading = await page.locator(".markdown-preview h1").first().innerText();
    assert(/List - Firewall rules/.test(heading), `unexpected heading: ${heading}`);
  });

  await test("Mermaid diagrams render as SVG, not as a code block", async () => {
    await expandTree(page, "Guides");
    await openPage(page, "Diagrams", "/Guides/Diagrams");
    await page.waitForSelector(".markdown-preview svg", { timeout: 60_000 });
    const svgCount = await page.locator(".markdown-preview svg").count();
    assert(svgCount >= 2, `expected both diagrams to render, found ${svgCount} svg`);
  });

  await test("the tree filter narrows the page list", async () => {
    const filter = page.locator(".powerwiki-nav-search-input");
    await filter.fill("diagram");

    // The filter can only match pages the app knows about, and the whole page
    // list arrives on a background prefetch a moment after load — so this waits
    // for the match rather than assuming the list is complete.
    // A nested match keeps its parent visible for context, so the assertion is
    // that the non-matching branches are gone — not that every row matches.
    await page.waitForFunction(
      () => {
        const links = [...document.querySelectorAll(".wiki-page-tree-link")];
        return (
          links.some((link) => /Diagrams/i.test(link.textContent ?? "")) &&
          !links.some((link) => /Release/i.test(link.textContent ?? ""))
        );
      },
      undefined,
      { timeout: 20_000 }
    );

    const shown = await page.locator(".wiki-page-tree-link").allInnerTexts();
    assert(shown.some((text) => /Diagrams/i.test(text)), `filter hid the match: ${shown.join(", ")}`);
    // The matched run is marked up so the reason for the match is visible.
    assert(
      (await page.locator(".wiki-page-tree-match").count()) > 0,
      "the matched text was not highlighted"
    );
    await filter.fill("");
  });

  await test("full-text search returns hits with highlighted snippets", async () => {
    await page.locator(".powerwiki-header-search-input").fill("mermaid");
    await page.waitForSelector(".powerwiki-content mark, .powerwiki-search-result", {
      timeout: 20_000
    });
    const body = await page.locator(".powerwiki-content").innerText();
    assert(/mermaid/i.test(body), "the results did not mention the term");
    await page.locator(".powerwiki-header-search-clear").click();
    await page.waitForSelector(".markdown-preview", { timeout: 15_000 });
  });

  await test("a page can be edited and saved, and the preview shows the change", async () => {
    await expandTree(page, "Guides");
    await openPage(page, "Diagrams", "/Guides/Diagrams");
    await clickMenuItem(page, "Edit page");
    await page.waitForSelector(".wiki-editor-shell", { timeout: 60_000 });

    // Through Monaco, the way a person edits, rather than by setting state.
    await page.locator(".wiki-editor-shell .monaco-editor").first().click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n\n## Added by the e2e run\n");

    await page.locator(".wiki-editor-toolbar-actions button", { hasText: "Save" }).click();
    await page.waitForSelector(".wiki-editor-shell", { state: "detached", timeout: 30_000 });
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".markdown-preview h2")].some((heading) =>
          (heading.textContent ?? "").includes("Added by the e2e run")
        ),
      undefined,
      { timeout: 20_000 }
    );
  });

  await test("the saved change is still there after navigating away and back", async () => {
    await expandTree(page, "Guides");
    await openPage(page, "Editing", "/Guides/Editing");
    await openPage(page, "Diagrams", "/Guides/Diagrams");
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".markdown-preview h2")].some((heading) =>
          (heading.textContent ?? "").includes("Added by the e2e run")
        ),
      undefined,
      { timeout: 20_000 }
    );
  });

  await test("creating a page opens it ready to edit", async () => {
    page.once("dialog", (dialog) => void dialog.accept("E2E Scratch"));
    await page.locator(".powerwiki-new-page").click();
    await page.waitForFunction(
      () =>
        document.querySelector(".powerwiki-content")?.getAttribute("data-powerwiki-page-path") ===
        "/E2E Scratch",
      undefined,
      { timeout: 20_000 }
    );
    // A new page is empty, so it opens in the editor rather than showing a blank
    // preview and making the user find "Edit".
    await page.waitForSelector(".wiki-editor-shell", { timeout: 30_000 });

    await page.locator(".wiki-editor-toolbar-actions button", { hasText: "Cancel" }).click();
    await page.waitForSelector(".wiki-editor-shell", { state: "detached", timeout: 15_000 });
  });

  await test("the export dialog offers Word and PDF", async () => {
    await clickMenuItem(page, "Export");
    await page.waitForSelector(".wiki-export-dialog", { timeout: 15_000 });
    const text = await page.locator(".wiki-export-dialog").innerText();
    assert(/Word/i.test(text), "Word export was not offered");
    assert(/PDF/i.test(text), "PDF export was not offered");

    // Word styling can come from the customer's own template (AB#593). The file
    // picker appears only once "Template file" is chosen, so it does not clutter
    // the common case.
    assert(/PowerWiki styling/i.test(text), "the Word template choice was not offered");
    assert(
      (await page.locator('.wiki-export-template input[type="file"]').count()) === 0,
      "the template file picker showed before it was chosen"
    );
    await page.locator(".wiki-export-template label", { hasText: "Template file" }).locator("input").check();
    await page.waitForSelector('.wiki-export-template input[type="file"]', { timeout: 10_000 });

    await page.locator(".wiki-export-dialog .wiki-export-close").click();
    await page.waitForSelector(".wiki-export-dialog", { state: "detached", timeout: 10_000 });
  });

  await test("history opens for the current page", async () => {
    await clickMenuItem(page, "History");
    await page.waitForSelector(".wiki-history-dialog", { timeout: 20_000 });
    await page.locator(".wiki-history-dialog .wiki-export-close").click();
    await page.waitForSelector(".wiki-history-dialog", { state: "detached", timeout: 10_000 });
  });

  // The two entries added for the Azure DevOps host; VS Code turns them off.
  await test("the VS Code hand-off entries are offered", async () => {
    await openHeaderMenu(page);
    const labels = await page.locator('[role="menu"] [role="menuitem"]').allInnerTexts();
    assert(
      labels.some((label) => /Install the VS Code extension/i.test(label)),
      `no install entry; menu was: ${labels.join(", ")}`
    );
    assert(
      labels.some((label) => /Clone wiki in VS Code/i.test(label)),
      `no clone entry; menu was: ${labels.join(", ")}`
    );

    // 1.3.10 shipped this action pointing at the wiki's *web* URL
    // (`.../_wiki/wikis/<guid>`), which git cannot clone — it follows the
    // redirect to a sign-in page and dies with "unable to update url base from
    // redirection". Assert the handler actually hands over a Git URL.
    const cloneUrl = await page.evaluate(async () => {
      const opened = [];
      const original = window.open;
      window.open = (url) => {
        opened.push(String(url));
        return null;
      };
      const items = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')];
      items.find((item) => /Clone wiki in VS Code/i.test(item.textContent ?? ""))?.click();
      await new Promise((resolve) => setTimeout(resolve, 200));
      window.open = original;
      return opened[0] ?? "";
    });

    assert(
      cloneUrl.startsWith("vscode://vscode.git/clone?url="),
      `clone action opened an unexpected URL: ${cloneUrl}`
    );
    const target = decodeURIComponent(cloneUrl.split("url=")[1] ?? "");
    assert(/\/_git\//.test(target), `clone URL is not a Git URL: ${target}`);
    assert(!/\/_wiki\//.test(target), `clone URL points at the wiki web UI: ${target}`);
    await closeHeaderMenu(page);
  });
}

/** A page link in the tree, by its visible label. */
function treeLink(page, label) {
  return page.locator(".wiki-page-tree-link").filter({ hasText: label }).first();
}

/** Expands a parent node if it is not already expanded. */
async function expandTree(page, label) {
  const row = page.locator(".wiki-page-tree-row").filter({ hasText: label }).first();
  const toggle = row.locator(".wiki-page-tree-toggle");
  if ((await toggle.getAttribute("aria-label"))?.startsWith("Expand")) {
    await toggle.click();
  }
  await page.waitForTimeout(200);
}

/**
 * Clicks a page in the tree and waits for the content area to actually show it.
 *
 * Expands the parent first if the page is not on screen: saving reloads a
 * folder's children, which can collapse it, and the test is about navigation
 * rather than about what the tree happened to have expanded.
 */
async function openPage(page, label, expectedPath) {
  const link = treeLink(page, label);
  if ((await link.count()) === 0) {
    const parent = expectedPath.split("/").filter(Boolean).slice(-2, -1)[0];
    if (parent) {
      await expandTree(page, parent);
    }
  }
  await link.click({ timeout: 20_000 });
  await page.waitForFunction(
    (target) =>
      document.querySelector(".powerwiki-content")?.getAttribute("data-powerwiki-page-path") ===
      target,
    expectedPath,
    { timeout: 20_000 }
  );
}

/**
 * Opens the page-actions menu and clicks an entry.
 *
 * Reports the entries it *did* find when the one asked for is missing — a bare
 * click timeout tells you nothing about whether the menu failed to open or the
 * label changed.
 */
async function clickMenuItem(page, label) {
  await openHeaderMenu(page);
  const items = page.locator('[role="menu"] [role="menuitem"]');
  const labels = await items.allInnerTexts();
  const index = labels.findIndex((text) => text.includes(label));
  if (index < 0) {
    throw new Error(`no "${label}" entry; the menu offered: ${labels.join(" | ")}`);
  }
  await items.nth(index).click();
}

async function openHeaderMenu(page) {
  if (await page.locator('[role="menu"]').count()) {
    return;
  }
  await page.locator(".powerwiki-header-menu-button").click();
  await page.waitForSelector('[role="menu"]', { timeout: 10_000 });
}

/** The menu closes on a pointerdown outside it, which is how a user dismisses it. */
async function closeHeaderMenu(page) {
  await page.locator(".powerwiki-header-title").click({ position: { x: 5, y: 5 } });
  await page.waitForSelector('[role="menu"]', { state: "detached", timeout: 10_000 });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/** Serves dist/ and media/ exactly as the development loop does. */
function startServer() {
  const server = spawn(
    process.execPath,
    [path.join(REPO_ROOT, "tools", "serve", "serve.mjs"), "--port", String(PORT)],
    { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] }
  );

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the sandbox server did not start")), 20_000);
    const ready = () => {
      clearTimeout(timer);
      resolve(server);
    };
    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes(String(PORT))) {
        ready();
      }
    });
    server.on("error", reject);
    // Some versions print nothing useful; poll as a fallback.
    const poll = setInterval(async () => {
      try {
        const response = await fetch(`${BASE}/dist/sandbox.html`);
        if (response.ok) {
          clearInterval(poll);
          ready();
        }
      } catch {
        // Not up yet.
      }
    }, 300);
    server.on("exit", () => clearInterval(poll));
  });
}

/**
 * Chromium, preferring the Playwright-managed build.
 *
 * This box deliberately has no system Chrome (see the note in `tools/pw/`), and
 * a version-namespaced Playwright build is what several projects can share
 * without fighting over one apt-managed browser.
 */
async function launchBrowser() {
  const options = { headless: HEADLESS, args: ["--no-sandbox", "--disable-gpu"] };
  try {
    return await chromium.launch(options);
  } catch (error) {
    throw new Error(
      `Could not launch Chromium: ${error.message}\n` +
        "Run `npx playwright install chromium` (not `install chrome`, which is a global apt install)."
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
