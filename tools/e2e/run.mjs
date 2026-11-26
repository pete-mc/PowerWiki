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
// says to use the canary for.
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
    results.push(`  FAIL  ${name}\n        ${error.message.split("\n").slice(0, 4).join(" ")}`);
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

  // The server is a child process holding the event loop open, so anything that
  // throws between here and the `finally` below would leave the run *hanging*
  // rather than failing - which is what a missing browser build did: an
  // immediate launch error, a process that never exited, and no output at all
  // because it is piped. Kill the server on the way out.
  let browser;
  try {
    browser = await launchBrowser();
  } catch (error) {
    server.kill();
    throw error;
  }
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      consoleErrors.push(`${message.text()}${location.url ? ` (${location.url})` : ""}`);
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  try {
    // A deliberate latency so loading states exist to be caught; see the sandbox.
    const query = new URLSearchParams({ latency: "40" });
    if (process.env.PW_E2E_THEME) query.set("theme", process.env.PW_E2E_THEME);
    await page.goto(`${BASE}/dist/sandbox.html?${query}`, { waitUntil: "domcontentloaded" });
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

  await test("emoji shortcodes render as characters, not as the text that was typed", async () => {
    await openPage(page, "Markdown-reference", "/Guides/Markdown-reference");
    const preview = await page.locator(".markdown-preview").innerText();

    assert(preview.includes("\u{1F7E2}"), "the :green_circle: shortcode did not render");
    assert(!preview.includes(":green_circle:"), `the shortcode was left as text: ${preview}`);
    // A pasted character survives the round trip through the renderer.
    assert(preview.includes("\u{1F680}"), "a pasted emoji character was lost");
    // ASCII emoticons stay as typed - see emojiPlugin.ts.
    assert(preview.includes(":)"), "an ASCII emoticon was converted");
  });

  // GitHub feedback: the two split panes scrolled independently, so the preview
  // showed something unrelated to the line being edited.
  await test("the split view's preview follows the editor as it scrolls", async () => {
    await openPage(page, "Markdown-reference", "/Guides/Markdown-reference");
    await clickMenuItem(page, "Edit page");
    await page.waitForSelector(".wiki-editor-shell", { timeout: 60_000 });
    await page.locator(".wiki-editor-mode-select").selectOption("splitCode");
    await page.waitForSelector(".wiki-editor-split-shell", { timeout: 60_000 });

    const previewTop = () =>
      page.locator(".wiki-editor-split-pane-preview").evaluate((pane) => pane.scrollTop);
    assert((await previewTop()) === 0, "the preview did not start at the top");

    // Scroll the editor the way a person does, rather than setting scrollTop:
    // the sync hangs off Monaco's own scroll event.
    await page.locator(".wiki-editor-split-pane-code .monaco-editor").first().click();
    await page.keyboard.press("Control+End");

    await page.waitForFunction(
      () => (document.querySelector(".wiki-editor-split-pane-preview")?.scrollTop ?? 0) > 0,
      undefined,
      { timeout: 20_000 }
    );
    assert((await previewTop()) > 0, "the preview stayed at the top while the editor moved");

    await page.locator(".wiki-editor-toolbar-actions button", { hasText: "Cancel" }).click();
    await page.waitForSelector(".wiki-editor-shell", { state: "detached", timeout: 15_000 });
  });

  await test("footnotes render, navigate and survive rich text editing", async () => {
    await openPage(page, "Markdown-reference", "/Guides/Markdown-reference");
    await clickMenuItem(page, "Edit page");
    await page.waitForSelector(".wiki-editor-shell", { timeout: 60_000 });
    try {
      await page.locator(".wiki-editor-mode-select").selectOption("splitCode");
      await page.waitForSelector(".wiki-editor-split-pane-code .monaco-editor", { timeout: 60_000 });
      await page.evaluate(() => {
        const model = window.monaco.editor.getModels()[0];
        model.setValue("# Footnotes\n\nA reference");
        const editor = window.monaco.editor.getEditors()[0];
        editor.setSelection(new window.monaco.Selection(3, 3, 3, model.getLineMaxColumn(3)));
      });
      await page.locator('button[title="Insert a footnote"]').click();
      await page.getByRole("menuitem", { name: "New footnote" }).click();
      let source = await page.evaluate(() => window.monaco.editor.getModels()[0].getValue());
      assert(source.includes("A reference[^1]") && source.includes("[^1]: Footnote text"), `new footnote was not inserted: ${source}`);
      await page.evaluate(() => {
        const model = window.monaco.editor.getModels()[0];
        window.monaco.editor.getEditors()[0].setPosition({ lineNumber: 3, column: model.getLineMaxColumn(3) });
      });
      await page.locator('button[title="Insert a footnote"]').click();
      await page.getByRole("menuitem", { name: "Reference 1" }).click();
      source = await page.evaluate(() => window.monaco.editor.getModels()[0].getValue());
      assert(source.includes("A reference[^1][^1]") && (source.match(/\[\^1\]:/g) ?? []).length === 1, `reused reference was not inserted: ${source}`);
      const preview = page.locator(".wiki-editor-split-pane-preview .markdown-preview");
      await preview.locator(".footnote-item").waitFor();
      assert((await preview.locator(".footnote-item").innerText()).includes("Footnote text"), "footnote text missing");
      await page.evaluate(() => {
        window.__footnoteTargets = [];
        const original = Element.prototype.scrollIntoView;
        window.__originalScrollIntoView = original;
        Element.prototype.scrollIntoView = function (...args) {
          window.__footnoteTargets.push(this.id);
          return original.apply(this, args);
        };
      });
      await preview.locator(".footnote-ref a[href]").first().click();
      await preview.locator(".footnote-backref").first().click();
      const targets = await page.evaluate(() => window.__footnoteTargets);
      assert(targets.includes("footnote1") && targets.includes("footnote-ref1"), `incorrect navigation targets: ${targets}`);
      await page.locator(".wiki-editor-mode-select").selectOption("richText");
      const richEditor = page.locator(".wiki-richtext-editor");
      await richEditor.waitFor();
      assert((await richEditor.locator(".wiki-richtext-footnote-ref").first().innerText()) === "[1]", "footnote reference was not rendered in Rich Text");
      assert((await richEditor.locator(".wiki-richtext-footnote").innerText()).includes("Footnote text"), "footnote content was not rendered in Rich Text");
      await richEditor.locator("h1").click();
      await page.keyboard.press("Control+Home");
      await page.keyboard.type("Updated ");
      await page.evaluate(() => {
        const paragraph = document.querySelector(".wiki-richtext-editor p");
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        range.collapse(false);
        const selection = document.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      });
      await page.locator('.wiki-richtext-toolbar button[title="Insert a footnote"]').click();
      page.once("dialog", (dialog) => dialog.accept("Rich <note> & text"));
      await page.getByRole("menuitem", { name: "New footnote" }).click();
      await page.waitForSelector(".wiki-richtext-editor [data-powerwiki-footnote-definition]", { timeout: 5000 });
      assert((await page.locator(".wiki-richtext-pending-footnotes").innerText()).includes("[2] Rich <note> & text"), "new footnote text is not visible");
      const borders = await page.evaluate(() => ({
        first: getComputedStyle(document.querySelector(".wiki-richtext-footnote")).borderTopWidth,
        pending: getComputedStyle(document.querySelector(".wiki-richtext-pending-footnotes")).borderTopWidth,
      }));
      assert(parseFloat(borders.first) > 0 && parseFloat(borders.pending) === 0, `incorrect footnote separators: ${JSON.stringify(borders)}`);
      await page.keyboard.press("Control+z");
      assert(await page.locator(".wiki-richtext-editor [data-powerwiki-footnote-definition]").count() === 0, "undo did not remove the new footnote");
      await page.keyboard.press("Control+y");
      await page.waitForSelector(".wiki-richtext-editor [data-powerwiki-footnote-definition]", { timeout: 5000 });
      await page.evaluate(() => {
        const paragraph = document.querySelector(".wiki-richtext-editor p");
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        range.collapse(false);
        const selection = document.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      });
      await page.locator('.wiki-richtext-toolbar button[title="Insert a footnote"]').click();
      await page.getByRole("menuitem", { name: "Reference 2" }).click();
      assert(await page.locator(".wiki-richtext-editor [data-powerwiki-footnote-definition]").count() === 2, "the repeated reference cannot preserve its new definition");
      await page.evaluate(() => {
        const paragraph = document.querySelector(".wiki-richtext-editor p");
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        range.collapse(true);
        const selection = document.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      });
      await page.locator('.wiki-richtext-toolbar button[title="Insert a footnote"]').click();
      page.once("dialog", (dialog) => dialog.accept("Earlier note"));
      await page.getByRole("menuitem", { name: "New footnote" }).click();
      await page.waitForFunction(() => document.querySelectorAll(".wiki-richtext-editor [data-powerwiki-footnote-definition]").length === 3);
      const renumbered = await richEditor.locator(".wiki-richtext-footnote-ref").allInnerTexts();
      assert(JSON.stringify(renumbered) === JSON.stringify(["[1]", "[2]", "[2:1]", "[3]", "[3:1]"]), `incorrect renumbering: ${renumbered}`);
      await page.keyboard.press("Control+z");
      await page.waitForFunction(() => document.querySelectorAll(".wiki-richtext-editor [data-powerwiki-footnote-definition]").length === 2);
      const afterUndo = await richEditor.locator(".wiki-richtext-footnote-ref").allInnerTexts();
      assert(JSON.stringify(afterUndo) === JSON.stringify(["[1]", "[1:1]", "[2]", "[2:1]"]), `undo did not restore numbering: ${afterUndo}`);
      await page.locator(".wiki-editor-mode-select").selectOption("splitCode");
      await page.waitForSelector(".wiki-editor-split-pane-code .monaco-editor");
      const restored = await page.evaluate(() => window.monaco.editor.getModels()[0].getValue());
      assert(restored.includes("[^1][^1][^2][^2]") && restored.includes("[^1]: Footnote text") && restored.includes("[^2]: Rich <note> & text") && restored.includes("Updated"), `rich-text editing changed the footnotes: ${JSON.stringify(restored)}`);

      await page.evaluate(() => window.monaco.editor.getModels()[0].setValue("# Notes\n\nNamed[^n] inline^[**Inline note**] repeated[^n].\n\n[^n]: Original note"));
      await page.locator(".wiki-editor-mode-select").selectOption("richText");
      await page.locator('.wiki-richtext-pending-footnotes[aria-label="Inline footnotes"]').waitFor();
      const mixedNumbers = await richEditor.locator(".wiki-richtext-footnote-ref").allInnerTexts();
      assert(JSON.stringify(mixedNumbers) === JSON.stringify(["[1]", "[2]", "[1:1]"]), `inline numbering incorrect: ${mixedNumbers}`);
      assert(await page.locator('[aria-label="Inline footnotes"] strong').innerText() === "Inline note", "inline note formatting missing");
      await richEditor.locator("p").first().click();
      await page.keyboard.press("End");
      await page.keyboard.type(" temporary");
      await page.keyboard.press("Control+z");
      await page.keyboard.type(" continuation");
      assert((await richEditor.locator("p").first().innerText()).includes("continuation"), "typing after undo moved away from the original paragraph");
      await page.keyboard.press("Control+z");
      await richEditor.locator("h1").click();
      await page.keyboard.press("End");
      await page.keyboard.type(" before");
      await richEditor.getByRole("button", { name: "Edit footnote n" }).click();
      await page.getByLabel("Footnote text (Markdown)").fill("Changed **note**\n\nSecond paragraph");
      await page.getByRole("button", { name: "Apply" }).click();
      assert((await richEditor.locator(".wiki-richtext-footnote").innerText()).includes("Second paragraph"), "edited footnote missing");
      await richEditor.locator("h1").click();
      await page.keyboard.press("End");
      await page.keyboard.type(" later");
      await page.keyboard.press("Control+z");
      assert(!(await richEditor.locator("h1").innerText()).includes("later"), "typing after footnote edit was not undone");
      await page.keyboard.press("Control+z");
      assert((await richEditor.locator(".wiki-richtext-footnote").innerText()).includes("Original note"), "footnote edit was not undoable");
      await page.keyboard.press("Control+z");
      assert(!(await richEditor.locator("h1").innerText()).includes("before"), "typing before footnote edit was not undone");
      await page.keyboard.press("Control+y");
      assert((await richEditor.locator("h1").innerText()).includes("before"), "typing before footnote edit was not redoable");
      await page.keyboard.press("Control+y");
      assert((await richEditor.locator(".wiki-richtext-footnote").innerText()).includes("Second paragraph"), "footnote edit was not redoable");
      await page.keyboard.press("Control+y");
      assert((await richEditor.locator("h1").innerText()).includes("later"), "typing after footnote edit was not redoable");
      await richEditor.evaluate((editor) => editor.dispatchEvent(new InputEvent("beforeinput", { inputType: "historyUndo", bubbles: true, cancelable: true })));
      assert(!(await richEditor.locator("h1").innerText()).includes("later"), "browser undo action was not handled");
      await richEditor.evaluate((editor) => editor.dispatchEvent(new InputEvent("beforeinput", { inputType: "historyRedo", bubbles: true, cancelable: true })));
      assert((await richEditor.locator("h1").innerText()).includes("later"), "browser redo action was not handled");
      await richEditor.locator("h1").click();
      await page.keyboard.press("End");
      await page.keyboard.type(" extra");
      await page.keyboard.press("Control+z");
      await page.keyboard.type(" changed");
      await page.keyboard.press("Control+y");
      assert((await richEditor.locator("h1").innerText()).includes("changed") && !(await richEditor.locator("h1").innerText()).includes("extra"), "new typing after undo did not clear redo");
      await page.locator('[aria-label="Inline footnotes"]').getByRole("button", { name: "Edit" }).click();
      await page.getByLabel("Footnote text (Markdown)").fill("Updated inline");
      await page.getByRole("button", { name: "Apply" }).click();
      await page.locator(".wiki-editor-mode-select").selectOption("splitCode");
      const editedNotes = await page.evaluate(() => window.monaco.editor.getModels()[0].getValue());
      assert(editedNotes.includes("[^n]: Changed **note**") && editedNotes.includes("    Second paragraph") && editedNotes.includes("^[Updated inline]") && editedNotes.includes("repeated[^n]"), `footnote edit lost Markdown: ${editedNotes}`);

      const fixture = "# Test\n\nMiddle text\n\n[^1]: Existing\n\n```md\n[^fake]: example\n```\n\nUnfinished[^2]";
      await page.evaluate((value) => {
        const model = window.monaco.editor.getModels()[0];
        model.setValue(value);
        window.monaco.editor.getEditors()[0].setPosition({ lineNumber: 3, column: 7 });
      }, fixture);
      const footnoteButton = page.locator('button[title="Insert a footnote"]');
      await footnoteButton.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("menuitem", { name: "Reference 1" }).waitFor();
      assert(await page.getByRole("menuitem", { name: "Reference fake" }).count() === 0, "code example offered as a footnote");
      await page.keyboard.press("Escape");
      assert(await page.getByRole("menu", { name: "Footnotes" }).count() === 0, "Escape did not close the footnote menu");
      await page.waitForFunction(() => document.querySelector(".monaco-editor")?.contains(document.activeElement), undefined, { timeout: 5000 });
      await footnoteButton.focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      const middle = await page.evaluate(() => window.monaco.editor.getModels()[0].getValue());
      assert(middle.includes("Middle[^3] text") && middle.includes("[^3]: Footnote text"), `middle insertion or label collision failed: ${middle}`);
      await page.keyboard.press("Control+z");
      assert(await page.evaluate(() => window.monaco.editor.getModels()[0].getValue()) === fixture, "undo did not remove the marker and definition together");
      await page.evaluate(() => {
        const model = window.monaco.editor.getModels()[0];
        window.monaco.editor.getEditors()[0].setPosition(model.getPositionAt(model.getValueLength()));
      });
      await footnoteButton.click();
      await page.getByRole("menuitem", { name: "New footnote" }).click();
      assert((await page.evaluate(() => window.monaco.editor.getModels()[0].getValue())).endsWith("[^3]\n\n[^3]: Footnote text\n"), "end-of-page insertion failed");
      await page.keyboard.press("Control+z");
      assert(await page.evaluate(() => window.monaco.editor.getModels()[0].getValue()) === fixture, "end-of-page undo failed");
      await page.evaluate(() => window.monaco.editor.getModels()[0].setValue("A code example: `[^note]`"));
      await page.locator(".wiki-editor-mode-select").selectOption("richText");
      await page.locator(".wiki-richtext-editor").waitFor({ timeout: 10000 });
    } finally {
      if (await page.getByRole("dialog").count()) await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
      await page.evaluate(() => {
        if (window.__originalScrollIntoView) Element.prototype.scrollIntoView = window.__originalScrollIntoView;
      });
      page.once("dialog", (dialog) => dialog.accept());
      await page.locator(".wiki-editor-toolbar-actions button", { hasText: "Cancel" }).click();
      await page.waitForSelector(".wiki-editor-shell", { state: "detached", timeout: 15_000 });
    }
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

  // Diagramming needs room: Maximize takes the draw.io dialog edge to edge.
  // (The sandbox has no host chrome to hide; that half is pw:verify's.)
  await test("the draw.io editor dialog maximizes to fill the window, and restores", async () => {
    // The editor itself is diagrams.net's, and nothing here needs it to load.
    await page.route("https://embed.diagrams.net/**", (route) => route.abort());
    await openPage(page, "Markdown-reference", "/Guides/Markdown-reference");
    await clickMenuItem(page, "Edit page");
    await page.waitForSelector(".wiki-editor-shell", { timeout: 60_000 });
    try {
      await page.locator(".wiki-editor-mode-select").selectOption("splitCode");
      await page.locator('.wiki-format-toolbar button[title*="draw.io"]').click();
      await page.waitForSelector(".powerwiki-drawio-maximize", { timeout: 15_000 });

      const dialog = page.locator(".powerwiki-drawio-dialog");
      const viewport = page.viewportSize();
      const normal = await dialog.boundingBox();
      assert(normal.width < viewport.width - 8, `the dialog started full width (${normal.width}px)`);

      await page.locator(".powerwiki-drawio-maximize").click();
      const maximized = await dialog.boundingBox();
      await page.screenshot({ path: path.join(ARTIFACTS, "drawio-maximized.png") });
      assert(
        maximized.width === viewport.width && maximized.height === viewport.height,
        `the maximized dialog is ${maximized.width}x${maximized.height}, not the whole ${viewport.width}x${viewport.height} window`
      );

      await page.keyboard.press("Escape");
      const restored = await dialog.boundingBox();
      assert(restored.width === normal.width, "Escape did not restore the dialog");
    } finally {
      // Leave the shell as the next test expects it, even after a failure.
      for (let i = 0; i < 3 && (await page.$(".powerwiki-drawio-dialog")); i += 1) {
        await page.keyboard.press("Escape");
      }
      await page.locator(".wiki-editor-toolbar-actions button", { hasText: "Cancel" }).click();
      await page.waitForSelector(".wiki-editor-shell", { state: "detached", timeout: 15_000 });
      await page.unroute("https://embed.diagrams.net/**");
    }
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
    await page.locator(".wiki-editor-mode-select").selectOption("richText");
    const editor = page.locator(".wiki-richtext-editor");
    await editor.click();
    await page.keyboard.type("First text");
    await page.keyboard.press("Control+z");
    assert(!(await editor.innerText()).includes("First text"), "undo failed on an empty page");
    await page.keyboard.press("Control+y");
    assert((await editor.innerText()).includes("First text"), "redo failed on an empty page");
    await editor.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press("Control+b");
    assert(await editor.locator("b, strong").count() > 0, "bold formatting was not applied");
    await page.keyboard.press("Control+z");
    assert(await editor.locator("b, strong").count() === 0 && (await editor.innerText()).includes("First text"), "undo lost text or failed to remove formatting");
    await page.keyboard.press("Control+y");
    assert(await editor.locator("b, strong").count() > 0, "redo did not restore formatting");
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.locator('.wiki-richtext-toolbar button', { hasText: "Table" }).click();
    assert(await editor.locator("table").count() === 1, "table was not inserted");
    await page.keyboard.press("Control+z");
    assert(await editor.locator("table").count() === 0, "undo did not remove the table");
    await page.keyboard.press("Control+y");
    assert(await editor.locator("table").count() === 1, "redo did not restore the table");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(() => navigator.clipboard.writeText("Pasted text åäö"));
    await editor.locator("td").first().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Control+v");
    assert((await editor.innerText()).includes("Pasted text åäö"), "clipboard paste failed");
    await page.keyboard.press("Control+z");
    assert(!(await editor.innerText()).includes("Pasted text åäö"), "undo did not remove pasted text");
    await page.keyboard.press("Control+y");
    assert((await editor.innerText()).includes("Pasted text åäö"), "redo did not restore pasted text");
    await editor.locator("td").first().click();
    await page.keyboard.press("End");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "に", selectionStart: 1, selectionEnd: 1 });
    await cdp.send("Input.imeSetComposition", { text: "日本", selectionStart: 2, selectionEnd: 2 });
    await cdp.send("Input.insertText", { text: "日本" });
    await cdp.detach();
    assert((await editor.innerText()).includes("日本"), "IME composition was not committed");
    await page.keyboard.press("Control+z");
    assert(!(await editor.innerText()).includes("日本") && !(await editor.innerText()).includes("に"), "undo did not remove the whole IME composition");
    await page.keyboard.press("Control+y");
    assert((await editor.innerText()).includes("日本"), "redo did not restore the IME composition");
    await page.locator(".wiki-editor-mode-select").selectOption("splitCode");
    await page.waitForSelector(".wiki-editor-split-pane-code .monaco-editor");
    const largeMarkdown = `# Large page\n\n${"A representative wiki paragraph with ordinary text and links.\n\n".repeat(2500)}Reference[^n].\n\n[^n]: A note.`;
    await page.evaluate((value) => window.monaco.editor.getModels()[0].setValue(value), largeMarkdown);
    await page.locator(".wiki-editor-mode-select").selectOption("richText");
    await editor.locator("h1").click();
    await page.keyboard.press("End");
    const largeStart = performance.now();
    await page.keyboard.type("1234567890");
    const largeElapsed = performance.now() - largeStart;
    await page.keyboard.press("Control+z");
    assert(!(await editor.locator("h1").innerText()).includes("1234567890"), "large-page typing was not undoable");
    await page.keyboard.press("Control+y");
    assert((await editor.locator("h1").innerText()).includes("1234567890"), "large-page typing was not redoable");
    console.log(`Large page: ${largeMarkdown.length} Markdown characters, 10 typed characters in ${Math.round(largeElapsed)} ms`);
    page.once("dialog", (dialog) => void dialog.accept());
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
  const options = { headless: HEADLESS, args: ["--no-sandbox", "--disable-gpu"], ...(process.env.PW_E2E_CHANNEL ? { channel: process.env.PW_E2E_CHANNEL } : {}) };
  try {
    return await chromium.launch(options);
  } catch (error) {
    throw new Error(
      `Could not launch Chromium: ${error.message}\n` +
      "Install Playwright Chromium, or set PW_E2E_CHANNEL=msedge to use Microsoft Edge."
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
