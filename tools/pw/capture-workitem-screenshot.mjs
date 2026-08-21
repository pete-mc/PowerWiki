// Captures the Marketplace screenshot of the Power Wiki tab on a work item
// (AB#594) into media/screenshots/powerwiki-workitem.png.
//
// Unlike capture-screenshots.mjs this drives the *work item form*, not the hub,
// so it navigates to a work item and opens the contributed tab. Point it at a
// work item that has at least one linked wiki page:
//
//   PW_EXTENSION=powerwiki-dev PW_WORKITEM=601 node tools/pw/capture-workitem-screenshot.mjs
//
// Needs a signed-in profile (`npm run pw:auth` once). Run it against the dev
// extension while `npm run dev:extension` serves the working tree, so the shot
// shows the build being released rather than the one already published.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hideVariantBuilds, launch, powerWikiFrame, sleep } from "./lib.mjs";

const ORG = process.env.PW_ORG ?? "dataversepowertools";
const PROJECT = process.env.PW_PROJECT ?? "PowerWiki";
const WORK_ITEM = process.env.PW_WORKITEM ?? "601";
// The tab's exact label. The dev and canary builds suffix their names, and with
// several installed a substring match picks whichever sorts first — so match
// exactly, and default to the public build's plain name.
const TAB_LABEL = process.env.PW_TAB ?? "Power Wiki";
const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "media",
  "screenshots",
  "powerwiki-workitem.png"
);

const { context, page } = await launch({ headless: true });

try {
  await page.goto(`https://dev.azure.com/${ORG}/${PROJECT}/_workitems/edit/${WORK_ITEM}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });

  // The contributed tab sits with Details/History/Links. It is identified by its
  // name rather than a generated id, which is not stable across installs.
  const tab = page.getByRole("tab", { name: TAB_LABEL, exact: true }).first();
  await tab.waitFor({ state: "visible", timeout: 120000 });
  await tab.click();

  // Positive assertion that the app actually mounted inside the tab's iframe —
  // a signed-out Azure DevOps page answers 203 with no sign-in marker, so
  // nothing weaker than this distinguishes "loaded" from "not signed in".
  const frame = await powerWikiFrame(page);
  await frame.waitForSelector(".markdown-preview", { timeout: 120000 });
  await frame.waitForSelector(".powerwiki-linked-item", { timeout: 60000 });
  // Let Mermaid finish; the linked page is the diagram gallery.
  await frame.waitForSelector(".mermaid-rendered svg", { timeout: 120000 }).catch(() => {});
  await sleep(3000);

  // No customer has the dev or canary builds, so their tabs do not belong in a
  // store screenshot beside the real one.
  console.log(`hid ${await hideVariantBuilds(page)} variant tab(s)`);

  await page.screenshot({ path: OUT });
  console.log(`captured ${OUT}`);
} finally {
  await context.close();
}
