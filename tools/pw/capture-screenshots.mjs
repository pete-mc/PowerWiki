// Captures the marketplace screenshots referenced by overview.md into
// media/screenshots/. Run against the live published build after sign-in
// (`npm run pw:auth`): node tools/pw/capture-screenshots.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, openWikiPage, sleep } from "./lib.mjs";

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "media", "screenshots");

const { context, page } = await launch({ headless: true });
const shot = (name) => page.screenshot({ path: path.join(OUT_DIR, name) });

try {
  // 1. Split editor: code on the left, live preview on the right. Captured first
  //    while the browser is freshest — Monaco's AMD load plus the mode switch are
  //    the most timing-sensitive step, so they go before the heavier pages.
  let frame = await openWikiPage(page, "#/PowerWiki%20Showcase", { timeoutMs: 300000 });
  await frame.waitForSelector(".markdown-preview", { timeout: 60000 });
  await frame.click(".powerwiki-header-menu-button");
  await frame.getByRole("menuitem", { name: "Edit page" }).click();
  await frame.waitForSelector(".wiki-page-editor .monaco-editor", { timeout: 90000 });
  await frame.waitForSelector(".wiki-editor-mode-select", { timeout: 30000 });
  await sleep(2500);
  // Playwright's selectOption actionability check races with React's controlled
  // re-render on this page; drive the change event straight through the element.
  await frame.locator(".wiki-editor-mode-select").evaluate((sel) => {
    sel.value = "splitCode";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await frame.waitForSelector(".wiki-editor-split-pane-code .monaco-editor", { state: "attached", timeout: 90000 });
  await sleep(2500);
  await shot("powerwiki-editing.png");
  console.log("captured editing");
  await frame.getByRole("button", { name: "Cancel" }).click();
  await sleep(500);

  // 2. Rendering: Home with badges, query table, byline.
  frame = await openWikiPage(page, "#/Home");
  await frame.waitForSelector(".powerwiki-work-item-badge-rich", { timeout: 60000 }).catch(() => {});
  await frame.waitForSelector(".powerwiki-query-table table", { timeout: 60000 }).catch(() => {});
  await sleep(2500);
  await shot("powerwiki-rendering.png");
  console.log("captured rendering");

  // 3. Mermaid gallery.
  frame = await openWikiPage(page, "#/PowerWiki%20Showcase/Mermaid%20Gallery");
  await frame.waitForSelector(".mermaid-rendered svg", { timeout: 60000 });
  await sleep(2500);
  await shot("powerwiki-mermaid.png");
  console.log("captured mermaid");

  // 4. Math.
  frame = await openWikiPage(page, "#/PowerWiki%20Showcase/Math%20with%20KaTeX");
  await frame.waitForSelector(".markdown-preview .katex", { state: "attached", timeout: 60000 });
  await frame.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
  await sleep(3000);
  await shot("powerwiki-math.png");
  console.log("captured math");

  // 5. History dialog with diff.
  frame = await openWikiPage(page, "#/Home");
  await frame.click(".powerwiki-header-menu-button");
  await frame.getByRole("menuitem", { name: "History" }).click();
  await frame.waitForSelector(".wiki-history-diff .monaco-diff-editor", { timeout: 60000 });
  await sleep(1500);
  await shot("powerwiki-history.png");
  console.log("captured history");
  await frame.click(".wiki-export-close");
  await sleep(300);

  // 6. Export dialog in multi-page mode.
  await frame.click(".powerwiki-header-menu-button");
  await frame.getByRole("menuitem", { name: "Export…" }).click();
  await frame.waitForSelector(".wiki-export-dialog", { timeout: 15000 });
  await frame.getByText("Multiple pages").click();
  await frame.waitForSelector(".wiki-export-tree", { timeout: 15000 });
  // Expand the showcase node and tick a few pages for a lively screenshot.
  await frame.evaluate(() => {
    const toggle = Array.from(document.querySelectorAll(".wiki-export-tree-toggle")).find((el) => !el.disabled);
    toggle?.click();
  });
  await sleep(1500);
  const boxes = await frame.$$(".wiki-export-tree input[type=checkbox]");
  for (const box of boxes.slice(0, 3)) {
    await box.click();
    await sleep(150);
  }
  await sleep(400);
  await shot("powerwiki-export.png");
  console.log("captured export");
  await frame.click(".wiki-export-close");
  await sleep(300);

  // 7. draw.io editor: opened on a diagram with real content on the canvas.
  //    The content is loaded through the same parent -> iframe channel the app
  //    uses, so the shot shows the genuine editor rather than a blank canvas.
  frame = await openWikiPage(page, "#/Home");
  await frame.click(".powerwiki-header-menu-button");
  await frame.getByRole("menuitem", { name: "Edit page" }).click();
  await frame.waitForSelector(".wiki-format-toolbar", { timeout: 60000 });
  await frame.click('.wiki-format-toolbar button[title*="draw.io"]');
  await frame.waitForSelector(".powerwiki-drawio-frame", { timeout: 60000 });
  await frame.fill("#powerwiki-drawio-title", "Deployment Topology");
  await sleep(6000); // let the editor boot before it will accept a load
  await frame.evaluate(() => {
    const xml =
      '<mxGraphModel dx="900" dy="640" grid="1" gridSize="10"><root>' +
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="u" value="Users" style="ellipse;whiteSpace=wrap;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="40" y="140" width="120" height="60" as="geometry"/></mxCell>' +
      '<mxCell id="fd" value="Front Door" style="rounded=1;whiteSpace=wrap;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1"><mxGeometry x="220" y="140" width="130" height="60" as="geometry"/></mxCell>' +
      '<mxCell id="api" value="API" style="rounded=1;whiteSpace=wrap;fillColor=#ffe6cc;strokeColor=#d79b00;" vertex="1" parent="1"><mxGeometry x="410" y="60" width="130" height="60" as="geometry"/></mxCell>' +
      '<mxCell id="web" value="Web App" style="rounded=1;whiteSpace=wrap;fillColor=#ffe6cc;strokeColor=#d79b00;" vertex="1" parent="1"><mxGeometry x="410" y="220" width="130" height="60" as="geometry"/></mxCell>' +
      '<mxCell id="db" value="Azure SQL" style="shape=cylinder3;whiteSpace=wrap;boundedLbl=1;fillColor=#e1d5e7;strokeColor=#9673a6;" vertex="1" parent="1"><mxGeometry x="610" y="130" width="120" height="80" as="geometry"/></mxCell>' +
      '<mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;rounded=1;" edge="1" parent="1" source="u" target="fd"><mxGeometry relative="1" as="geometry"/></mxCell>' +
      '<mxCell id="e2" style="edgeStyle=orthogonalEdgeStyle;rounded=1;" edge="1" parent="1" source="fd" target="api"><mxGeometry relative="1" as="geometry"/></mxCell>' +
      '<mxCell id="e3" style="edgeStyle=orthogonalEdgeStyle;rounded=1;" edge="1" parent="1" source="fd" target="web"><mxGeometry relative="1" as="geometry"/></mxCell>' +
      '<mxCell id="e4" style="edgeStyle=orthogonalEdgeStyle;rounded=1;" edge="1" parent="1" source="api" target="db"><mxGeometry relative="1" as="geometry"/></mxCell>' +
      '<mxCell id="e5" style="edgeStyle=orthogonalEdgeStyle;rounded=1;" edge="1" parent="1" source="web" target="db"><mxGeometry relative="1" as="geometry"/></mxCell>' +
      "</root></mxGraphModel>";
    document
      .querySelector(".powerwiki-drawio-frame")
      ?.contentWindow?.postMessage(
        JSON.stringify({ action: "load", autosave: 0, xml }),
        "https://embed.diagrams.net"
      );
  });
  await sleep(5000);
  await shot("powerwiki-drawio.png");
  console.log("captured drawio");
} catch (error) {
  console.error("capture failed:", error.message);
  process.exitCode = 1;
} finally {
  await context.close();
}
