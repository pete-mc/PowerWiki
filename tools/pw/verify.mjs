// PowerWiki smoke test. Reaches into the extension's cross-origin iframe to
// assert real behavior: rendering + byline, enrichment surviving navigation,
// and image upload actually rendering (which also proves the attachments API
// base64 body is correct). Requires a signed-in profile — run `npm run pw:auth`
// once first. Screenshots and a summary are written to tools/pw/artifacts/.
import fs from "node:fs";
import path from "node:path";
import {
  ARTIFACTS_DIR,
  launch,
  openWikiPage,
  readLoadedVersion,
  sleep,
} from "./lib.mjs";

// A valid 1x1 PNG — if the attachments body encoding is wrong the stored bytes
// won't decode and the <img> will have naturalWidth 0.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const failures = [];
function check(condition, message) {
  console.log(`${condition ? "PASS" : "FAIL"}: ${message}`);
  if (!condition) {
    failures.push(message);
  }
}

fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
const { context, page } = await launch({ headless: false });
// Answer confirms (discard edits, delete) by accepting, and prompts (new page
// title) with the current promptResponse.
let promptResponse = "";
page.on("dialog", async (d) => {
  try {
    await d.accept(d.type() === "prompt" ? promptResponse : undefined);
  } catch {
    // dialog already handled/closed
  }
});
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") {
    consoleErrors.push(m.text());
  }
});
const failedResponses = [];
let attachmentResp = null;
page.on("response", async (r) => {
  if (r.status() >= 400) {
    failedResponses.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  }
  if (r.url().includes("/attachments") && r.request().method() === "PUT") {
    try {
      attachmentResp = { status: r.status(), body: (await r.text()).slice(0, 600) };
    } catch {
      attachmentResp = { status: r.status(), body: "<unreadable>" };
    }
  }
});

try {
  // 1. Home: rendering, work-item/query enrichment, byline.
  let frame = await openWikiPage(page, "#/Home", { timeoutMs: 300000 });
  console.log(`Loaded PowerWiki version: ${(await readLoadedVersion(frame)) || "unknown"}`);
  await frame.waitForSelector(".powerwiki-work-item-badge-rich", { timeout: 60000 }).catch(() => {});
  await frame.waitForSelector(".powerwiki-query-table table", { timeout: 60000 }).catch(() => {});
  check(!!(await frame.$(".powerwiki-work-item-badge-rich")), "work item badge enriched on Home");
  check(!!(await frame.$(".powerwiki-query-table table")), "query table rendered on Home");
  await frame
    .waitForFunction(
      () => {
        const b = document.querySelector(".wiki-byline");
        return b && !/Not available|Loading/.test(b.textContent || "");
      },
      { timeout: 30000 }
    )
    .catch(() => {});
  const byline = await frame.$eval(".wiki-byline", (el) => el.textContent || "").catch(() => "");
  check(byline.length > 0 && !/Not available|Loading/.test(byline), "byline shows author/date on Home");
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, "01-home.png") });

  // 2. Enrichment survives navigation (Home -> Showcase -> Home).
  frame = await openWikiPage(page, "#/PowerWiki%20Showcase");
  await frame.waitForSelector(".mermaid-rendered svg", { timeout: 60000 }).catch(() => {});
  check(!!(await frame.$(".mermaid-rendered svg")), "mermaid diagram rendered on Showcase");
  frame = await openWikiPage(page, "#/Home");
  await sleep(1500);
  check(!!(await frame.$(".powerwiki-work-item-badge-rich")), "work item badge still enriched after navigation");
  check(!!(await frame.$(".powerwiki-query-table table")), "query table still rendered after navigation");

  // 3. Image upload renders (validates the attachments base64 body).
  try {
    await frame.click(".powerwiki-header-menu-button");
    await frame.getByRole("menuitem", { name: "Edit page" }).click();
    await frame.waitForSelector(".wiki-editor-mode-select", { timeout: 30000 });
    await frame.selectOption(".wiki-editor-mode-select", "splitCode");
    // Wait for Monaco to finish loading and focus it, so the inserted reference
    // lands in a ready editor (the Image button is disabled until then anyway).
    await frame.waitForSelector(".wiki-editor-split-pane-code .monaco-editor", { timeout: 30000 });
    await frame.click(".wiki-editor-split-pane-code .monaco-editor");
    // Move to a fresh line at the end of the document so the inserted image
    // isn't dropped inside an existing code fence (which renders as text).
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await sleep(300);
    await frame.setInputFiles('input[type="file"]', {
      name: `pw-smoke-${Date.now()}.png`,
      mimeType: "image/png",
      buffer: Buffer.from(PNG_BASE64, "base64"),
    });
    await sleep(6000);
    const diag = await frame.evaluate(() => {
      const img = document.querySelector(".wiki-editor-split-pane-preview .markdown-preview img");
      const err = document.querySelector(".wiki-format-status-error");
      const models = (window.monaco && window.monaco.editor && window.monaco.editor.getModels()) || [];
      const preview = document.querySelector(".wiki-editor-split-pane-preview .markdown-preview");
      return {
        hasImg: !!img,
        imgSrc: img ? img.getAttribute("src") : null,
        naturalWidth: img ? img.naturalWidth : 0,
        uploadError: err ? err.textContent : null,
        editorHasAttachment: models.some((m) => m.getValue().includes(".attachments")),
        editorTail: models.length ? models[0].getValue().slice(-160) : null,
        previewHtmlTail: preview ? preview.innerHTML.slice(-300) : null,
      };
    });
    console.log("upload diag:", JSON.stringify(diag));
    check(diag.hasImg && diag.naturalWidth > 0, "uploaded image renders in preview (attachments base64 body correct)");
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "02-upload.png") });
  } catch (error) {
    check(false, `image upload flow failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "02-upload-error.png") });
  }

  // Rich Text mode: upload a fresh image and confirm it renders inline.
  try {
    await frame.selectOption(".wiki-editor-mode-select", "richText");
    await frame.waitForSelector(".wiki-richtext-editor", { timeout: 30000 });
    const before = await frame.$$eval(".wiki-richtext-editor img", (els) => els.length);
    await frame.click(".wiki-richtext-editor");
    await frame.setInputFiles('input[type="file"]', {
      name: `pw-smoke-rt-${Date.now()}.png`,
      mimeType: "image/png",
      buffer: Buffer.from(PNG_BASE64, "base64"),
    });
    await frame.waitForFunction(
      (n) => document.querySelectorAll(".wiki-richtext-editor img").length > n,
      before,
      { timeout: 60000 }
    );
    await sleep(1500);
    const rtOk = await frame.evaluate(() => {
      const imgs = document.querySelectorAll(".wiki-richtext-editor img");
      const img = imgs[imgs.length - 1];
      return !!img && img.complete && img.naturalWidth > 0;
    });
    check(rtOk, "uploaded image renders in the rich text editor");
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "03-richtext.png") });
  } catch (error) {
    check(false, `rich text upload failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "03-richtext-error.png") });
  }

  // Create -> verify -> delete a page: a self-cleaning round-trip over the
  // create and delete write paths (leaving the editor prompts a discard confirm,
  // then a title prompt, both answered by the dialog handler above).
  try {
    const pageName = `PW-Smoke-${Date.now()}`;
    promptResponse = pageName;
    await frame.click(".powerwiki-new-page");
    await frame.waitForSelector(`[aria-label="Actions for ${pageName}"]`, { timeout: 60000 });
    check(true, "created a new page (tree shows it)");

    await frame.click(`[aria-label="Actions for ${pageName}"]`);
    await frame.getByRole("menuitem", { name: "Delete" }).click();
    await frame.waitForSelector(`[aria-label="Actions for ${pageName}"]`, {
      state: "detached",
      timeout: 60000,
    });
    check(true, "deleted the page (tree no longer shows it)");
  } catch (error) {
    check(false, `create/delete round-trip failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "04-create-delete-error.png") });
  }
} catch (error) {
  check(false, `unexpected error: ${error.message}`);
} finally {
  const errorNoise = consoleErrors.filter(
    (e) => !/MeProxy|savedusers-proxy|net::ERR_ABORTED 404/.test(e)
  );
  console.log("\n--- iframe/page console errors ---");
  console.log(errorNoise.length ? errorNoise.slice(0, 20).join("\n") : "(none)");
  const relevantFailures = failedResponses.filter((r) => /attachments|\/Items|_apis\/git|_apis\/wiki/.test(r));
  console.log("\n--- failed responses (attachments/wiki/git) ---");
  console.log(relevantFailures.length ? relevantFailures.slice(0, 20).join("\n") : "(none)");
  console.log("\n--- attachments PUT response ---");
  console.log(attachmentResp ? JSON.stringify(attachmentResp) : "(no attachments PUT seen)");
  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, "summary.json"),
    JSON.stringify({ failures, consoleErrors: errorNoise }, null, 2)
  );
  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`}`);
  await context.close();
  process.exitCode = failures.length === 0 ? 0 : 1;
}
