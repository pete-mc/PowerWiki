// PowerWiki smoke test. Reaches into the extension's cross-origin iframe to
// assert real behavior: rendering + byline, enrichment surviving navigation,
// and image upload actually rendering (which also proves the attachments API
// base64 body is correct). Requires a signed-in profile — run `npm run pw:auth`
// once first. Screenshots and a summary are written to tools/pw/artifacts/.
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import {
  ARTIFACTS_DIR,
  launch,
  openWikiPage,
  powerWikiFrame,
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

// Hash navigation inside the hub is same-document, so the previous page's DOM
// is still on screen right after openWikiPage returns. Wait for the header to
// name the page we asked for before asserting on (or exporting) its content.
async function waitForPageTitle(frame, title, timeout = 60000) {
  await frame.waitForFunction(
    (expected) => document.querySelector(".powerwiki-header-title h1")?.textContent?.trim() === expected,
    title,
    { timeout }
  );
}

// Best-effort return to view mode (and close any dialog) so one failed
// editor test can't cascade into the next by leaving the app mid-edit.
async function leaveEditor(page, frame) {
  try {
    await page.keyboard.press("Escape");
    const cancel = await frame.$('.wiki-editor-toolbar-actions button:has-text("Cancel"), .wiki-export-close');
    if (cancel) {
      await cancel.click();
      await sleep(400);
    }
  } catch {
    // ignore
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

  // Host tab title reflects the active page name. The extension runs in a
  // cross-origin iframe, so this is set via the host navigation service —
  // document.title inside the iframe wouldn't reach the browser tab.
  await page.waitForFunction(() => /Home/.test(document.title), { timeout: 15000 }).catch(() => {});
  check(/Home/.test(await page.title()), `host tab title reflects the page name (title=${JSON.stringify(await page.title())})`);

  // 2. Enrichment survives navigation (Home -> Showcase -> Home).
  frame = await openWikiPage(page, "#/PowerWiki%20Showcase");
  await frame.waitForSelector(".mermaid-rendered svg", { timeout: 60000 }).catch(() => {});
  check(!!(await frame.$(".mermaid-rendered svg")), "mermaid diagram rendered on Showcase");
  // The tab title tracks navigation, not just the first load.
  await page.waitForFunction(() => /Showcase/.test(document.title), { timeout: 15000 }).catch(() => {});
  check(/Showcase/.test(await page.title()), `host tab title updates on navigation (title=${JSON.stringify(await page.title())})`);
  frame = await openWikiPage(page, "#/Home");
  // Wait for the enrichment rather than assuming a fixed delay. The query table
  // re-runs a saved query on every navigation, which is slower than the work
  // item badge beside it — a bare sleep here made this assertion flaky as soon
  // as the query got slower. A generous timeout still catches the regression
  // this guards against (enrichment never coming back), it just doesn't fail on
  // a slow round trip.
  await frame.waitForSelector(".powerwiki-work-item-badge-rich", { timeout: 30000 }).catch(() => {});
  await frame.waitForSelector(".powerwiki-query-table table", { timeout: 30000 }).catch(() => {});
  check(!!(await frame.$(".powerwiki-work-item-badge-rich")), "work item badge still enriched after navigation");
  check(!!(await frame.$(".powerwiki-query-table table")), "query table still rendered after navigation");

  // Scroll resets to the top on in-app navigation. The content area persists
  // across pages (it lives outside the per-page boundary), so a scrolled page
  // would otherwise carry its scroll to the next. Uses a real in-app tree click,
  // not openWikiPage (a full reload would reset scroll on its own).
  try {
    frame = await openWikiPage(page, "#/PowerWiki%20Showcase");
    await frame.waitForSelector(".mermaid-rendered svg", { timeout: 60000 });
    await sleep(1000);
    const scrolledTo = await frame.evaluate(() => {
      const c = document.querySelector(".powerwiki-content");
      if (!c) return 0;
      c.scrollTop = c.scrollHeight;
      return c.scrollTop;
    });
    await sleep(300);
    await frame.locator(".wiki-page-tree-link", { hasText: "Home" }).first().click();
    await frame.waitForSelector(".powerwiki-query-table table", { timeout: 60000 });
    await sleep(800);
    const afterNav = await frame.evaluate(() => document.querySelector(".powerwiki-content")?.scrollTop ?? -1);
    check(
      scrolledTo > 0 && afterNav === 0,
      `content scroll resets to top on navigation (was ${scrolledTo}, now ${afterNav})`
    );
  } catch (error) {
    check(false, `scroll-reset check failed: ${error.message}`);
  }

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


  // Rendering features (callouts, heading anchors, copy-code, syntax
  // highlighting) via the split editor's live preview — set the Monaco model
  // directly so bracket auto-closing can't corrupt the [!NOTE] marker.
  try {
    // The create/delete test may have left no active page; reload Home first.
    frame = await openWikiPage(page, "#/Home");
    await frame.click(".powerwiki-header-menu-button");
    await frame.getByRole("menuitem", { name: "Edit page" }).click();
    await frame.waitForSelector(".wiki-editor-mode-select", { timeout: 30000 });
    await frame.selectOption(".wiki-editor-mode-select", "splitCode");
    await frame.waitForSelector(".wiki-editor-split-pane-code .monaco-editor", { timeout: 30000 });
    const testMd = "# Heading One\n\n> [!NOTE]\n> A note callout.\n\n```ts\nconst answer: number = 42;\n```\n";
    await frame.evaluate((value) => {
      const models = window.monaco && window.monaco.editor ? window.monaco.editor.getModels() : [];
      if (models[0]) {
        models[0].setValue(value);
      }
    }, testMd);

    const preview = ".wiki-editor-split-pane-preview .markdown-preview";
    await frame.waitForSelector(`${preview} .powerwiki-callout-note`, { timeout: 30000 });
    check(true, "callout renders in the preview");
    check(!!(await frame.$(`${preview} .powerwiki-heading-anchor`)), "heading permalink anchor present");
    check(!!(await frame.$(`${preview} pre .powerwiki-copy-code`)), "copy-code button present");
    await frame.waitForSelector(`${preview} pre code.hljs`, { timeout: 15000 });
    check(true, "code block is syntax-highlighted");
    // #28: clicking copy actually copies — the button flips to "Copied" only when
    // the write succeeds (via the execCommand fallback in the sandboxed iframe).
    await frame.click(`${preview} pre .powerwiki-copy-code`);
    const copyOk = await frame
      .waitForFunction(
        (sel) => document.querySelector(`${sel} pre .powerwiki-copy-code`)?.textContent === "Copied",
        preview,
        { timeout: 5000 }
      )
      .then(() => true)
      .catch(() => false);
    check(copyOk, "copy-code button copies (button shows Copied)");
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "05-rendering.png") });
  } catch (error) {
    check(false, `rendering features failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "05-rendering-error.png") });
  }

  // Headings written without a space after the hashes render as headings, with
  // the one exception that keeps "#1234" an Azure Boards work-item reference.
  try {
    const headingMd = "#Loose Heading\n\n###Third Level\n\n#1234 needs a repro\n";
    await frame.evaluate((value) => {
      const models = window.monaco && window.monaco.editor ? window.monaco.editor.getModels() : [];
      if (models[0]) {
        models[0].setValue(value);
      }
    }, headingMd);

    const preview = ".wiki-editor-split-pane-preview .markdown-preview";
    await frame.waitForSelector(`${preview} h1`, { timeout: 30000 });
    const headings = await frame.evaluate((sel) => {
      const root = document.querySelector(sel);
      const text = (node) => (node?.textContent || "").replace(/#$/, "").trim();
      return {
        h1: text(root?.querySelector("h1")),
        h3: text(root?.querySelector("h3")),
        badge: text(root?.querySelector(".powerwiki-work-item-badge")),
        headingCount: root?.querySelectorAll("h1, h2, h3, h4, h5, h6").length ?? 0,
        raw: (root?.textContent || "").includes("#Loose"),
      };
    }, preview);
    check(headings.h1 === "Loose Heading", `#Heading renders as an h1 (got "${headings.h1}")`);
    check(headings.h3 === "Third Level", `###Heading renders as an h3 (got "${headings.h3}")`);
    check(!headings.raw, "the hashes are not left as literal text");
    check(headings.badge.includes("1234"), `#1234 stays a work-item badge (got "${headings.badge}")`);
    check(headings.headingCount === 2, `#1234 did not become a heading (headings=${headings.headingCount})`);
  } catch (error) {
    check(false, `spaceless headings failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "05b-headings-error.png") });
  }

  // Release B: a latest-generation Mermaid type renders (validates the diagram
  // chunk loads), and the diagram toolbar + pan/zoom overlay work.
  try {
    const mermaidMd = '```mermaid\nxychart-beta\n  title "Test"\n  x-axis [a, b, c]\n  y-axis "V" 0 --> 10\n  bar [3, 6, 9]\n```\n';
    await frame.evaluate((value) => {
      const models = window.monaco && window.monaco.editor ? window.monaco.editor.getModels() : [];
      if (models[0]) {
        models[0].setValue(value);
      }
    }, mermaidMd);

    const preview = ".wiki-editor-split-pane-preview .markdown-preview";
    await frame.waitForSelector(`${preview} pre.mermaid-rendered svg`, { timeout: 30000 });
    check(!(await frame.$(`${preview} .mermaid-error`)), "latest Mermaid type (xychart) renders without error");
    await frame.waitForSelector(`${preview} .powerwiki-mermaid-tools`, { timeout: 10000 });
    check(true, "mermaid diagram toolbar present");
    // #31: PNG export was removed (it failed on foreignObject diagrams); SVG stays.
    check(!!(await frame.$(`${preview} [data-mermaid-action="svg"]`)), "mermaid SVG download button present");
    check(!(await frame.$(`${preview} [data-mermaid-action="png"]`)), "mermaid PNG button removed");
    await frame.click(`${preview} [data-mermaid-action="zoom"]`);
    await frame.waitForSelector(".powerwiki-mermaid-zoom", { timeout: 10000 });
    check(true, "mermaid pan/zoom overlay opens");
    // #30: the overlay opens fit-to-stage, not at the tiny in-article scale 1.
    const zoomScale = await frame.evaluate(() => {
      const content = document.querySelector(".powerwiki-mermaid-zoom-content");
      const m = content && /scale\(([\d.]+)\)/.exec(content.getAttribute("style") || "");
      return m ? Number(m[1]) : 0;
    });
    check(zoomScale > 1, `mermaid zoom opens fit-to-stage (scale=${zoomScale})`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "06-mermaid.png") });

    // Close the zoom overlay, then make the diagram source invalid (as happens
    // mid-edit) and confirm Mermaid's "Syntax error" bomb graphic is NOT leaked
    // into the document — it used to be orphaned on document.body below the
    // editor and shove the layout.
    await page.keyboard.press("Escape").catch(() => {});
    await frame.evaluate(() => {
      const models = window.monaco && window.monaco.editor ? window.monaco.editor.getModels() : [];
      if (models[0]) {
        models[0].setValue("```mermaid\nflowchart TD\n  A --> ((( bad\n```\n");
      }
    });
    await sleep(1500);
    const bomb = await frame.evaluate(() =>
      // The bomb's text, or mermaid's temporary "d{id}" render node left on the
      // page. (A rendered diagram's SVG has id "powerwiki-mermaid-N" with no "d"
      // prefix and is legitimate, so it must not be matched here.)
      document.body.innerText.includes("Syntax error in text") ||
      !!document.querySelector('[id^="dpowerwiki-mermaid"]')
    );
    check(!bomb, "invalid mermaid does not leak the Syntax-error graphic into the page");
  } catch (error) {
    check(false, `mermaid features failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "06-mermaid-error.png") });
  }

  // draw.io diagrams: a stored .drawio.png gets an "Edit diagram" affordance in
  // the preview, and the editor toolbar offers a way to create one. Guards the
  // plumbing that makes editing possible — the authored path surviving image
  // resolution, and the tools being injected onto diagram images only.
  try {
    const diagramMd = [
      "![Architecture](/.attachments/Architecture-lk9f2abc1234.drawio.png)",
      "",
      "![Screenshot](/.attachments/plain-screenshot.png)",
      "",
    ].join("\n");
    await frame.evaluate((value) => {
      const models = window.monaco && window.monaco.editor ? window.monaco.editor.getModels() : [];
      if (models[0]) {
        models[0].setValue(value);
      }
    }, diagramMd);

    const preview = ".wiki-editor-split-pane-preview .markdown-preview";
    await frame.waitForSelector(`${preview} .powerwiki-diagram-edit`, { timeout: 30000 });
    const diagrams = await frame.evaluate((sel) => {
      const root = document.querySelector(sel);
      const buttons = Array.from(root?.querySelectorAll(".powerwiki-diagram-edit") ?? []);
      return {
        count: buttons.length,
        src: buttons[0]?.getAttribute("data-powerwiki-diagram-src") ?? "",
        images: root?.querySelectorAll("img").length ?? 0,
      };
    }, preview);
    check(diagrams.count === 1, `only the .drawio.png gets an edit button (buttons=${diagrams.count})`);
    check(diagrams.images === 2, `both images still render (images=${diagrams.images})`);
    check(
      diagrams.src === "/.attachments/Architecture-lk9f2abc1234.drawio.png",
      `edit button carries the authored diagram path (got "${diagrams.src}")`
    );
    check(
      !!(await frame.$('.wiki-format-toolbar button[title*="draw.io"]')),
      "editor toolbar offers a New diagram button"
    );
  } catch (error) {
    check(false, `draw.io diagram affordances failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "06b-drawio-error.png") });
  }

  // Release C: KaTeX math renders (loads the katex chunk + CSS).
  try {
    const mathMd = "Inline $E = mc^2$ and a block:\n\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$\n";
    await frame.evaluate((value) => {
      const models = window.monaco && window.monaco.editor ? window.monaco.editor.getModels() : [];
      if (models[0]) {
        models[0].setValue(value);
      }
    }, mathMd);

    const preview = ".wiki-editor-split-pane-preview .markdown-preview";
    await frame.waitForSelector(`${preview} .katex`, { timeout: 30000 });
    check(true, "KaTeX math renders");
    // The KaTeX <annotation> stores the exact TeX it rendered. If the equation
    // was rendered twice on top of itself (the concurrent-renderMath race) the
    // annotation is the mangled, tripled string rather than the source TeX.
    const splitAnnotation = await frame.evaluate((sel) => {
      const a = document.querySelector(`${sel} .katex annotation`);
      return a ? (a.textContent || "").trim() : null;
    }, preview);
    check(splitAnnotation === "E = mc^2", `KaTeX renders the equation once (annotation=${JSON.stringify(splitAnnotation)})`);
    // Let the KaTeX fonts finish loading so the screenshot shows real glyphs.
    await frame.evaluate(() => document.fonts.ready).catch(() => {});
    await sleep(1000);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "07-math.png") });
  } catch (error) {
    check(false, `math rendering failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "07-math-error.png") });
  }

  // The renderMath race only fires on a full page view (an async subpage list
  // re-runs the preview layout effect while KaTeX is still importing), not in the
  // split editor above — so assert directly on the Math showcase viewer page that
  // every equation's annotation is its source TeX, not a self-stacked copy.
  try {
    frame = await openWikiPage(page, "#/PowerWiki%20Showcase/Math%20with%20KaTeX");
    // The KaTeX <annotation> is present but visually hidden, so wait for attach.
    await frame.waitForSelector(".markdown-preview .katex annotation", { state: "attached", timeout: 30000 });
    await sleep(2000);
    const mathViewer = await frame.evaluate(() => {
      const annotations = Array.from(document.querySelectorAll(".markdown-preview .katex annotation")).map(
        (a) => (a.textContent || "").trim()
      );
      const firstInline = annotations[0] ?? null;
      // A stacked render repeats the same core (e.g. "mc^2") more than once.
      const stacked = annotations.filter((t) => (t.match(/mc\^?2/g) || []).length > 1);
      return { count: annotations.length, firstInline, stacked };
    });
    check(
      mathViewer.firstInline === "E = mc^2" && mathViewer.stacked.length === 0,
      `math renders once on the viewer page (first=${JSON.stringify(mathViewer.firstInline)}, stacked=${mathViewer.stacked.length})`
    );
    await frame.evaluate(() => document.fonts.ready).catch(() => {});
    await sleep(500);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "07b-math-viewer.png") });

    // #29: heading permalinks are absolute Azure DevOps deep links (so copying
    // them works), not the default "#slug" relative to the CDN iframe.
    const heading = await frame.evaluate(() => {
      const a = document.querySelector(".markdown-preview a.powerwiki-heading-anchor");
      return a ? a.getAttribute("href") : null;
    });
    check(
      !!heading && heading.startsWith("https://dev.azure.com/") && heading.includes("&anchor="),
      `heading permalink is an absolute deep link (${JSON.stringify(heading)})`
    );

    // #29 (scroll): a deep link with &anchor= scrolls the heading near the top.
    frame = await openWikiPage(page, "#/PowerWiki%20Showcase/Math%20with%20KaTeX&anchor=display");
    await frame.waitForSelector(".markdown-preview #display", { timeout: 30000 });
    await sleep(1500);
    const headingTop = await frame.evaluate(() => {
      const h = document.querySelector(".markdown-preview #display");
      return h ? Math.round(h.getBoundingClientRect().top) : 99999;
    });
    check(headingTop < 400, `anchor deep link scrolls the heading into view (top=${headingTop})`);
  } catch (error) {
    check(false, `math viewer rendering failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "07b-math-viewer-error.png") });
  }

  // #32: the query-table id column is a plain hyperlinked id, not a full
  // work-item badge (badges stay for #N references in the page body).
  try {
    frame = await openWikiPage(page, "#/Home");
    await frame.waitForSelector(".powerwiki-query-table table", { timeout: 60000 });
    await sleep(1000);
    const queryIds = await frame.evaluate(() => {
      const plain = document.querySelectorAll(".powerwiki-query-table .powerwiki-query-id-link").length;
      const richInTable = document.querySelectorAll(
        ".powerwiki-query-table .powerwiki-work-item-badge-rich"
      ).length;
      const richInBody = document.querySelectorAll(
        ".markdown-preview > .powerwiki-work-item-badge-rich, .markdown-preview p .powerwiki-work-item-badge-rich"
      ).length;
      return { plain, richInTable, richInBody };
    });
    check(
      queryIds.plain > 0 && queryIds.richInTable === 0,
      `query id column uses plain links, not badges (plain=${queryIds.plain}, richInTable=${queryIds.richInTable})`
    );
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "08-query-ids.png") });
  } catch (error) {
    check(false, `query id column check failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "08-query-ids-error.png") });
  }

  // Authoring R1 #10: Ctrl+B wraps the selection, and the page-link picker
  // inserts a Markdown link to another wiki page.
  try {
    frame = await openWikiPage(page, "#/Home");
    await frame.click(".powerwiki-header-menu-button");
    await frame.getByRole("menuitem", { name: "Edit page" }).click();
    await frame.waitForSelector(".wiki-page-editor .monaco-editor", { timeout: 30000 });
    await frame.evaluate(() => {
      const models = (window.monaco && window.monaco.editor && window.monaco.editor.getModels()) || [];
      if (models[0]) models[0].setValue("word");
    });
    await frame.click(".wiki-page-editor .monaco-editor");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Control+b");
    await sleep(300);
    const boldValue = await frame.evaluate(() => {
      const models = (window.monaco && window.monaco.editor && window.monaco.editor.getModels()) || [];
      return models[0] ? models[0].getValue() : null;
    });
    check(boldValue === "**word**", `Ctrl+B wraps the selection in bold (got ${JSON.stringify(boldValue)})`);

    await frame.click(".wiki-format-linkpicker > button");
    await frame.waitForSelector(".wiki-format-linkpicker-popover", { timeout: 10000 });
    const pickerCount = await frame.$$eval(".wiki-format-linkpicker-item", (els) => els.length);
    check(pickerCount > 0, `page-link picker lists pages (${pickerCount})`);
    await frame.click(".wiki-format-linkpicker-item");
    await sleep(300);
    const linkValue = await frame.evaluate(() => {
      const models = (window.monaco && window.monaco.editor && window.monaco.editor.getModels()) || [];
      return models[0] ? models[0].getValue() : "";
    });
    check(/\]\(\/.+\)/.test(linkValue), `page-link picker inserts a Markdown link (${JSON.stringify(linkValue)})`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "09-editor-quickwins.png") });
    // Discard so the Home page content is left untouched.
    await frame.getByRole("button", { name: "Cancel" }).click();
    await sleep(500);
  } catch (error) {
    check(false, `editor quick wins failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "09-editor-quickwins-error.png") });
  }

  // Authoring R1 #25: an autosaved edit is offered for recovery after a reload.
  try {
    frame = await openWikiPage(page, "#/Home");
    await frame.click(".powerwiki-header-menu-button");
    await frame.getByRole("menuitem", { name: "Edit page" }).click();
    await frame.waitForSelector(".wiki-page-editor .monaco-editor", { timeout: 30000 });
    const marker = `AUTOSAVE_${Date.now()}`;
    await frame.evaluate((mk) => {
      const models = (window.monaco && window.monaco.editor && window.monaco.editor.getModels()) || [];
      if (models[0]) models[0].setValue(`${models[0].getValue()}\n\n${mk}`);
    }, marker);
    await sleep(1300); // exceed the 800ms autosave debounce
    // Simulate an accidental refresh with a real document reload (a same-URL
    // openWikiPage would be a same-document hash nav and not remount the app).
    await page.reload({ waitUntil: "domcontentloaded" });
    frame = await powerWikiFrame(page);
    await frame.waitForSelector(".wiki-draft-recovery", { timeout: 30000 });
    check(true, "autosaved draft offers recovery after reload");
    await frame.click(".wiki-draft-recovery-restore");
    await frame.waitForSelector(".wiki-page-editor .monaco-editor", { timeout: 30000 });
    await sleep(300);
    const restored = await frame.evaluate(() => {
      const models = (window.monaco && window.monaco.editor && window.monaco.editor.getModels()) || [];
      return models[0] ? models[0].getValue() : "";
    });
    check(restored.includes(marker), "restored draft contains the autosaved text");
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "10-autosave.png") });
    // Cleanup: discard the draft so it doesn't linger for the next run.
    await frame.getByRole("button", { name: "Cancel" }).click();
    await sleep(500);
    const draftCleared = await frame.$(".wiki-draft-recovery");
    check(!draftCleared, "discarding the draft clears the recovery banner");
  } catch (error) {
    check(false, `autosave/draft recovery failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "10-autosave-error.png") });
  }

  // Authoring R2 #24: the slash-command palette inserts a Markdown element.
  // "/query" matches only the Query table command, so the top suggestion is
  // unambiguous.
  try {
    frame = await openWikiPage(page, "#/Home");
    await frame.click(".powerwiki-header-menu-button");
    await frame.getByRole("menuitem", { name: "Edit page" }).click();
    await frame.waitForSelector(".wiki-page-editor .monaco-editor", { timeout: 30000 });
    await frame.evaluate(() => {
      const models = (window.monaco && window.monaco.editor && window.monaco.editor.getModels()) || [];
      if (models[0]) models[0].setValue("");
    });
    await frame.click(".wiki-page-editor .monaco-editor");
    await sleep(400); // let Monaco settle focus/caret before typing the trigger
    await page.keyboard.type("/query");
    await frame.waitForSelector(".monaco-editor .suggest-widget.visible", { timeout: 15000 });
    await sleep(300);
    await page.keyboard.press("Enter");
    await sleep(300);
    const slashValue = await frame.evaluate(() => {
      const models = (window.monaco && window.monaco.editor && window.monaco.editor.getModels()) || [];
      return models[0] ? models[0].getValue() : "";
    });
    check(
      slashValue.includes("::: query-table") && !slashValue.includes("/query"),
      `slash-command palette inserts an element (${JSON.stringify(slashValue.slice(0, 40))})`
    );
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "11-slash.png") });
    await frame.getByRole("button", { name: "Cancel" }).click();
    await sleep(500);
  } catch (error) {
    check(false, `slash-command palette failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "11-slash-error.png") });
    await leaveEditor(page, frame);
  }

  // Authoring R3 #27: in-context table editing — the floating toolbar appears
  // when a cell is focused and adds a row/column.
  try {
    frame = await openWikiPage(page, "#/Home");
    await frame.click(".powerwiki-header-menu-button");
    await frame.getByRole("menuitem", { name: "Edit page" }).click();
    await frame.waitForSelector(".wiki-editor-mode-select", { timeout: 30000 });
    await frame.selectOption(".wiki-editor-mode-select", "richText");
    await frame.waitForSelector(".wiki-richtext-editor", { timeout: 30000 });
    // Clear the page (Home already contains a table) so the inserted one is the
    // only table on the surface.
    await frame.click(".wiki-richtext-editor");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await frame.getByRole("button", { name: "Table", exact: true }).click();
    await frame.waitForSelector(".wiki-richtext-editor table tbody td", { timeout: 10000 });
    const before = await frame.evaluate(() => {
      const t = document.querySelector(".wiki-richtext-editor table");
      return { rows: t.rows.length, cols: t.rows[0].cells.length };
    });
    // Focus a body cell to reveal the floating toolbar, then add a row + column.
    await frame.click(".wiki-richtext-editor table tbody td");
    await frame.waitForSelector(".wiki-richtext-table-tools", { timeout: 10000 });
    check(true, "table toolbar appears when a cell is focused");
    await frame.click('.wiki-richtext-table-tools button[title="Insert row below"]');
    await frame.click('.wiki-richtext-table-tools button[title="Insert column right"]');
    await sleep(300);
    const after = await frame.evaluate(() => {
      const t = document.querySelector(".wiki-richtext-editor table");
      return { rows: t.rows.length, cols: t.rows[0].cells.length };
    });
    check(after.rows === before.rows + 1, `in-context insert adds a row (${before.rows} -> ${after.rows})`);
    check(after.cols === before.cols + 1, `in-context insert adds a column (${before.cols} -> ${after.cols})`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "12-table-tools.png") });
    await frame.getByRole("button", { name: "Cancel" }).click();
    await sleep(500);
  } catch (error) {
    check(false, `in-context table editing failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "12-table-tools-error.png") });
    await leaveEditor(page, frame);
  }

  // Export #6: exporting a Mermaid-heavy page downloads a valid .docx (so the
  // Markdown + Mermaid render pipeline runs end to end without throwing).
  try {
    frame = await openWikiPage(page, "#/PowerWiki%20Showcase/Mermaid%20Gallery");
    // Wait for the Gallery to actually be the active page — the previous page
    // also has rendered diagrams, so ".mermaid-rendered svg" alone matches it.
    await waitForPageTitle(frame, "Mermaid Gallery");
    await frame.waitForSelector(".mermaid-rendered svg", { timeout: 60000 });
    await frame.click(".powerwiki-header-menu-button");
    await frame.getByRole("menuitem", { name: "Export…" }).click();
    await frame.waitForSelector(".wiki-export-dialog", { timeout: 10000 });
    check(true, "export dialog opens from the page menu");
    const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
    await frame.getByRole("button", { name: "Export Word" }).click();
    const download = await downloadPromise;
    const docxPath = path.join(ARTIFACTS_DIR, "export.docx");
    await download.saveAs(docxPath);
    const bytes = fs.readFileSync(docxPath);
    const name = download.suggestedFilename();
    const isZip = bytes.length > 1000 && bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
    check(isZip, `Word export downloads a valid .docx (${bytes.length} bytes, name=${name})`);
    check(/mermaid/i.test(name), `export used the Mermaid page (name=${name})`);
    // Diagrams must arrive as images. Mermaid's default HTML labels render into
    // a <foreignObject>, which taints the canvas the export rasterizes through —
    // every such diagram then degraded to a "[diagram]" placeholder.
    const docxZip = await JSZip.loadAsync(bytes);
    const media = Object.keys(docxZip.files).filter((entry) => entry.startsWith("word/media/"));
    const exportXml = await docxZip.file("word/document.xml").async("string");
    check(media.length > 0, `Word export embeds the diagrams as images (${media.length} media parts)`);
    check(!exportXml.includes("[diagram]"), "no diagram degraded to a [diagram] placeholder");
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "13-export.png") });
  } catch (error) {
    check(false, `Word export failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "13-export-error.png") });
    await leaveEditor(page, frame);
  }

  // Word export of a math page produces native Word equations (OMML), not TeX.
  try {
    frame = await openWikiPage(page, "#/PowerWiki%20Showcase/Math%20with%20KaTeX");
    await waitForPageTitle(frame, "Math with KaTeX");
    await frame.waitForSelector(".markdown-preview .katex", { state: "attached", timeout: 60000 });
    await frame.click(".powerwiki-header-menu-button");
    await frame.getByRole("menuitem", { name: "Export…" }).click();
    await frame.waitForSelector(".wiki-export-dialog", { timeout: 10000 });
    const mathDownload = page.waitForEvent("download", { timeout: 120000 });
    await frame.getByRole("button", { name: "Export Word" }).click();
    const download = await mathDownload;
    const docxPath = path.join(ARTIFACTS_DIR, "export-math.docx");
    await download.saveAs(docxPath);
    const zip = await JSZip.loadAsync(fs.readFileSync(docxPath));
    const documentXml = await zip.file("word/document.xml").async("string");
    check(
      documentXml.includes("oMath") && !documentXml.includes("<undefined>"),
      `Word export renders KaTeX as valid native Word equations (oMath, no <undefined>)`
    );
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "13b-export-math.png") });
  } catch (error) {
    check(false, `Word math export failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "13b-export-math-error.png") });
  }

  // Export #18: PDF export renders enriched HTML (query tables, work-item
  // badges, mermaid) into a print root. window.print is stubbed so the headless
  // run doesn't hang, and the print root persists (afterprint never fires) so we
  // can assert its content.
  try {
    frame = await openWikiPage(page, "#/Home");
    await frame.waitForSelector(".powerwiki-query-table table", { timeout: 60000 });
    await frame.evaluate(() => {
      window.print = () => {};
    });
    await frame.click(".powerwiki-header-menu-button");
    await frame.getByRole("menuitem", { name: "Export…" }).click();
    await frame.waitForSelector(".wiki-export-dialog", { timeout: 10000 });
    await frame.getByText("PDF (print)").click();
    await frame.getByRole("button", { name: "Export PDF" }).click();
    // The print root is display:none on screen (only shown while printing), so
    // wait for it to be attached rather than visible.
    await frame.waitForSelector(".pw-print-root", { state: "attached", timeout: 60000 });
    const pdf = await frame.evaluate(() => {
      const root = document.querySelector(".pw-print-root");
      return {
        queryTables: root ? root.querySelectorAll(".powerwiki-query-table table").length : 0,
        richBadges: root ? root.querySelectorAll(".powerwiki-work-item-badge-rich").length : 0,
      };
    });
    check(
      pdf.queryTables > 0 && pdf.richBadges > 0,
      `PDF export renders enriched HTML (queryTables=${pdf.queryTables}, badges=${pdf.richBadges})`
    );
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "14-pdf.png") });
    await frame.evaluate(() => document.querySelector(".pw-print-root")?.remove());
  } catch (error) {
    check(false, `PDF export failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "14-pdf-error.png") });
  }

  // Export selector: the multi-page tree lazy-loads child page names on expand.
  try {
    frame = await openWikiPage(page, "#/Home");
    await frame.click(".powerwiki-header-menu-button");
    await frame.getByRole("menuitem", { name: "Export…" }).click();
    await frame.waitForSelector(".wiki-export-dialog", { timeout: 10000 });
    await frame.getByText("Multiple pages").click();
    await frame.waitForSelector(".wiki-export-tree", { timeout: 10000 });
    const before = await frame.$$eval(".wiki-export-tree .wiki-export-item", (els) => els.length);
    // Expand the first node that has children.
    const expanded = await frame.evaluate(() => {
      const toggles = Array.from(document.querySelectorAll(".wiki-export-tree-toggle"));
      const toggle = toggles.find((button) => !button.disabled);
      if (toggle) {
        toggle.click();
        return true;
      }
      return false;
    });
    let grew = false;
    if (expanded) {
      grew = await frame
        .waitForFunction(
          (n) => document.querySelectorAll(".wiki-export-tree .wiki-export-item").length > n,
          before,
          { timeout: 15000 }
        )
        .then(() => true)
        .catch(() => false);
    }
    check(expanded && grew, `export tree lazy-loads children on expand (before=${before})`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "15-export-tree.png") });
    await frame.getByRole("button", { name: "Cancel" }).click();
  } catch (error) {
    check(false, `export tree lazy load failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "15-export-tree-error.png") });
  }

  // Parity #33: tree page names carry a tooltip with the full name.
  // Parity #7: the History dialog lists revisions and shows a Monaco diff.
  try {
    frame = await openWikiPage(page, "#/Home");
    const hasTooltip = await frame.$eval(
      ".wiki-page-tree-link",
      (el) => (el.getAttribute("title") || "").length > 0
    );
    check(hasTooltip, "tree page names have a full-name tooltip");

    await frame.click(".powerwiki-header-menu-button");
    await frame.getByRole("menuitem", { name: "History" }).click();
    await frame.waitForSelector(".wiki-history-item", { timeout: 60000 });
    const revisionCount = await frame.$$eval(".wiki-history-item", (els) => els.length);
    check(revisionCount > 0, `history lists revisions (${revisionCount})`);
    await frame.waitForSelector(".wiki-history-diff .monaco-diff-editor", { timeout: 60000 });
    check(true, "history shows a Monaco diff for the selected revision");
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "16-history.png") });
    await frame.click(".wiki-export-close");
    await sleep(300);
  } catch (error) {
    check(false, `history/compare failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "16-history-error.png") });
  }

  // Parity #17: attachments dialog lists the wiki's stored files.
  try {
    frame = await openWikiPage(page, "#/Home");
    await frame.click(".powerwiki-header-menu-button");
    await frame.getByRole("menuitem", { name: "Attachments…" }).click();
    await frame.waitForSelector(".wiki-attachment-card", { timeout: 60000 });
    const attachmentCount = await frame.$$eval(".wiki-attachment-card", (els) => els.length);
    check(attachmentCount > 0, `attachments dialog lists files (${attachmentCount})`);
    // Attachment images sit behind the authenticated Git Items API, so a bare
    // <img src> 302-redirects to sign-in and never loads. Assert a thumbnail
    // actually decodes (naturalWidth > 0), proving the credentialed object-URL
    // fetch works — this guards the image-loading regression.
    const thumbLoaded = await frame
      .waitForFunction(
        () =>
          Array.from(document.querySelectorAll(".wiki-attachment-card img")).some(
            (img) => img.complete && img.naturalWidth > 0
          ),
        { timeout: 30000 }
      )
      .then(() => true)
      .catch(() => false);
    check(thumbLoaded, "attachment image thumbnail loads (authenticated fetch)");
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "18-attachments.png") });
    await frame.click(".wiki-export-close");
    await sleep(300);
  } catch (error) {
    check(false, `attachments dialog failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "18-attachments-error.png") });
  }

  // Parity #17: the editor's attachment picker inserts an existing reference.
  try {
    await frame.click(".powerwiki-header-menu-button");
    await frame.getByRole("menuitem", { name: "Edit page" }).click();
    await frame.waitForSelector(".wiki-page-editor .monaco-editor", { timeout: 30000 });
    await frame.evaluate(() => {
      const models = (window.monaco && window.monaco.editor && window.monaco.editor.getModels()) || [];
      if (models[0]) models[0].setValue("");
    });
    await frame.getByRole("button", { name: "Attachment ▾" }).click();
    await frame.waitForSelector(".wiki-format-linkpicker-item", { timeout: 60000 });
    await frame.click(".wiki-format-linkpicker-item");
    await sleep(300);
    const inserted = await frame.evaluate(() => {
      const models = (window.monaco && window.monaco.editor && window.monaco.editor.getModels()) || [];
      return models[0] ? models[0].getValue() : "";
    });
    check(inserted.includes("/.attachments/"), `attachment picker inserts a reference (${JSON.stringify(inserted.slice(0, 50))})`);
    await frame.getByRole("button", { name: "Cancel" }).click();
    await sleep(500);
  } catch (error) {
    check(false, `attachment picker failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "19-attach-picker-error.png") });
    await leaveEditor(page, frame);
  }

  // Parity #20: follow round-trip — Follow page flips to Unfollow, then back.
  try {
    frame = await openWikiPage(page, "#/Home");
    await frame.click(".powerwiki-header-menu-button");
    const followItem = frame.getByRole("menuitem", { name: /^(Follow|Unfollow) page$/ });
    await followItem.waitFor({ timeout: 30000 });
    const initialLabel = (await followItem.textContent()) ?? "";
    await followItem.click();
    await sleep(2500);
    await frame.click(".powerwiki-header-menu-button");
    const toggledLabel = (await frame.getByRole("menuitem", { name: /^(Follow|Unfollow) page$/ }).textContent()) ?? "";
    const flipped =
      (initialLabel.trim() === "Follow page" && toggledLabel.trim() === "Unfollow page") ||
      (initialLabel.trim() === "Unfollow page" && toggledLabel.trim() === "Follow page");
    check(flipped, `follow toggles (${initialLabel.trim()} -> ${toggledLabel.trim()})`);
    // Toggle back to restore the original state.
    await frame.getByRole("menuitem", { name: /^(Follow|Unfollow) page$/ }).click();
    await sleep(2000);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "20-follow.png") });
  } catch (error) {
    check(false, `follow toggle failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "20-follow-error.png") });
  }

  // Rendering: `@<guid>` identity mentions resolve to display names through the
  // host identity service. The team group below is deliberately NOT the signed-in
  // user, so a pass proves the host-service lookup works on the extension's
  // existing scopes (no vso.identity / vso.graph) rather than just hitting the
  // current-user shortcut in AzureDevOpsIdentityClient.
  // Default team of the PowerWiki project; override both together when running
  // against your own organization (see PW_ORG/PW_PROJECT in tools/pw/README.md).
  const TEAM_IDENTITY = process.env.PW_TEAM_ID ?? "e7be2f2f-d2b8-4332-af96-606b9d7c937e";
  // The host returns a group as "[project]\Team Name"; PowerWiki strips the
  // scope so the chip reads naturally in a sentence.
  const TEAM_NAME = process.env.PW_TEAM_NAME ?? "PowerWiki Team";
  try {
    frame = await openWikiPage(page, "#/Home");
    await frame.click(".powerwiki-header-menu-button");
    await frame.getByRole("menuitem", { name: "Edit page" }).click();
    await frame.waitForSelector(".wiki-page-editor .monaco-editor", { timeout: 30000 });
    await frame.locator(".wiki-editor-mode-select").evaluate((sel) => {
      sel.value = "splitCode";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await frame.waitForSelector(".wiki-editor-split-pane-code .monaco-editor", { timeout: 60000 });
    await frame.evaluate((id) => {
      const models = (window.monaco && window.monaco.editor && window.monaco.editor.getModels()) || [];
      if (models[0]) {
        models[0].setValue(
          `Owned by @<${id}> and @<00000000-0000-0000-0000-000000000000>.\n\n` +
            "![sized](/.attachments/pw-size-probe.png =320x180)\n\n" +
            "![wide](/.attachments/pw-size-probe.png =240x)\n"
        );
      }
    }, TEAM_IDENTITY);
    // The lookup round-trips to the host frame, so give it room to settle.
    // Every mention has to be waited on, not just the first: an identity that
    // fails to resolve only gets its fallback text on the enrichment pass after
    // its lookup rejects, so sampling early catches it still showing "@…".
    await frame.waitForFunction(
      () => {
        const els = Array.from(document.querySelectorAll(".markdown-preview .powerwiki-mention"));
        return els.length > 0 && els.every((el) => !el.textContent.includes("…"));
      },
      { timeout: 30000 }
    );
    const mentions = await frame.$$eval(".markdown-preview .powerwiki-mention", (els) =>
      els.map((el) => ({ text: el.textContent, unresolved: el.classList.contains("powerwiki-mention-unresolved") }))
    );
    const raw = await frame.$eval(".markdown-preview", (el) => el.textContent);
    check(mentions.length === 2, `both mentions become chips (${mentions.length})`);
    check(!/@</.test(raw), "the raw @<guid> tag is gone from the rendered page");
    check(
      mentions[0]?.text === `@${TEAM_NAME}`,
      `mention resolves to a display name (${JSON.stringify(mentions[0]?.text)})`
    );
    check(
      mentions[1]?.unresolved === true,
      `an unknown identity falls back cleanly (${JSON.stringify(mentions[1]?.text)})`
    );

    // Rendering: the Azure DevOps `=WxH` image-size suffix. Before this was
    // supported markdown-it rejected the whole image and the author's Markdown
    // showed up as literal text, so assert the <img> exists with the size on it.
    const sized = await frame.$$eval(".markdown-preview img", (els) =>
      els.map((el) => ({ w: el.getAttribute("width"), h: el.getAttribute("height") }))
    );
    const previewText = await frame.$eval(".markdown-preview", (el) => el.textContent);
    check(sized.length === 2, `sized images render as <img> (${sized.length})`);
    check(
      sized[0]?.w === "320" && sized[0]?.h === "180",
      `=320x180 sets both dimensions (${JSON.stringify(sized[0])})`
    );
    check(
      sized[1]?.w === "240" && !sized[1]?.h,
      `=240x sets width only (${JSON.stringify(sized[1])})`
    );
    check(!previewText.includes("=320x180"), "the size suffix is not left as literal text");

    // Editing: the editor should fill the content area rather than stopping at a
    // fixed viewport fraction. In split mode the code pane and the preview pane
    // should end up the same height, with the editor consuming what's left of the
    // shell under the format toolbar.
    const layout = await frame.evaluate(() => {
      const h = (sel) => {
        const el = document.querySelector(sel);
        return el ? Math.round(el.getBoundingClientRect().height) : 0;
      };
      return {
        content: h(".powerwiki-content"),
        shell: h(".wiki-editor-split-shell"),
        code: h(".wiki-editor-split-pane-code"),
        preview: h(".wiki-editor-split-pane-preview"),
        monaco: h(".wiki-editor-split-pane-code .monaco-editor"),
        toolbar: h(".wiki-editor-split-pane-code .wiki-format-toolbar"),
      };
    });
    check(
      Math.abs(layout.code - layout.preview) <= 2,
      `split panes are the same height (code=${layout.code}, preview=${layout.preview})`
    );
    check(
      layout.monaco >= layout.code - layout.toolbar - 4,
      `Monaco fills the code pane (monaco=${layout.monaco}, pane=${layout.code}, toolbar=${layout.toolbar})`
    );
    // The old fixed min(72vh, 820px) left the shell well short of the content
    // area; now it should claim essentially all of it.
    check(
      layout.shell >= layout.content * 0.8,
      `editor fills the content area (shell=${layout.shell}, content=${layout.content})`
    );
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "21-mentions-and-height.png") });
    await frame.getByRole("button", { name: "Cancel" }).click();
    await sleep(500);
  } catch (error) {
    check(false, `mention rendering / editor height failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "21-mentions-and-height-error.png") });
    await leaveEditor(page, frame);
  }

  // Navigation: the page-tree rail can be dragged wider and snaps back on a
  // double-click.
  try {
    frame = await openWikiPage(page, "#/Home");
    await frame.waitForSelector(".powerwiki-nav-resizer", { timeout: 30000 });
    const navBox = await frame.locator(".powerwiki-nav").boundingBox();
    const handle = await frame.locator(".powerwiki-nav-resizer").boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 150, handle.y + handle.height / 2, { steps: 10 });
    await page.mouse.up();
    await sleep(300);
    const widened = await frame.locator(".powerwiki-nav").boundingBox();
    check(
      widened.width > navBox.width + 100,
      `page tree drags wider (${Math.round(navBox.width)} -> ${Math.round(widened.width)})`
    );
    // The width is a personal preference, so it must survive a reload.
    await page.reload({ waitUntil: "domcontentloaded" });
    frame = await powerWikiFrame(page);
    await frame.waitForSelector(".powerwiki-nav-resizer", { timeout: 30000 });
    const restored = await frame.locator(".powerwiki-nav").boundingBox();
    check(
      Math.abs(restored.width - widened.width) <= 2,
      `the dragged width persists across a reload (${Math.round(restored.width)})`
    );
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "22-nav-resize.png") });
    // Reset so the profile doesn't carry a widened rail into later runs.
    await frame.dblclick(".powerwiki-nav-resizer");
    await sleep(300);
    const reset = await frame.locator(".powerwiki-nav").boundingBox();
    check(Math.abs(reset.width - 240) <= 2, `double-click resets the rail (${Math.round(reset.width)})`);
  } catch (error) {
    check(false, `page tree resize failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "22-nav-resize-error.png") });
  }

  // History follows renames, as the built-in wiki does. Azure DevOps has no
  // `git log --follow`, so without the rename-hop walk this would show only the
  // rename commit and the page's creation would be invisible. Runs last: it
  // creates, renames, and deletes a page, so a failure mid-flow can't leave the
  // app in a state that breaks the checks above.
  try {
    const original = `PW-Rename-${Date.now()}`;
    const renamed = `${original}-renamed`;
    promptResponse = original;
    await frame.click(".powerwiki-new-page");
    await frame.waitForSelector(`[aria-label="Actions for ${original}"]`, { timeout: 60000 });
    await leaveEditor(page, frame);

    promptResponse = renamed;
    await frame.click(`[aria-label="Actions for ${original}"]`);
    await frame.getByRole("menuitem", { name: "Rename" }).click();
    await frame.waitForSelector(`[aria-label="Actions for ${renamed}"]`, { timeout: 60000 });

    // Navigate by hash rather than clicking the tree: deterministic, and it
    // makes the renamed page the active one whose history we open.
    frame = await openWikiPage(page, `#/${renamed}`);
    await frame.click(".powerwiki-header-menu-button");
    await frame.getByRole("menuitem", { name: "History" }).click();
    await frame.waitForSelector(".wiki-history-item", { timeout: 90000 });
    await sleep(2000);

    const comments = await frame.$$eval(".wiki-history-item", (els) =>
      els.map((el) => (el.textContent || "").replace(/\s+/g, " "))
    );
    const joined = comments.join(" | ");
    check(comments.length >= 2, `history spans the rename (${comments.length} revisions)`);
    check(/Renamed page/i.test(joined), "the rename commit is listed");
    check(
      new RegExp(`Added page '/${original}'`, "i").test(joined),
      "the pre-rename creation is still listed, under the old name"
    );

    await frame.click(".wiki-export-close");
    await sleep(400);
    await frame.click(`[aria-label="Actions for ${renamed}"]`);
    await frame.getByRole("menuitem", { name: "Delete" }).click();
    await frame.waitForSelector(`[aria-label="Actions for ${renamed}"]`, { state: "detached", timeout: 60000 });
  } catch (error) {
    check(false, `history-across-rename failed: ${error.message}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "23-rename-history-error.png") });
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
