// Shared Playwright helpers for driving PowerWiki inside Azure DevOps.
//
// PowerWiki renders in a cross-origin iframe (gallerycdn.vsassets.io) inside
// dev.azure.com. Playwright can reach into that frame (DOM, console, network),
// which the Claude-in-Chrome extension cannot. Auth is handled once by signing
// in to a dedicated persistent Chrome profile (see auth.mjs); every later run
// reuses that profile's cookies. See tools/pw/README.md and agents.md.
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

// Which Azure DevOps organization/project to drive. The harness targets the
// *published* Marketplace build, so point it at any org that has PowerWiki
// installed and a wiki to read:
//
//   PW_ORG=myorg PW_PROJECT=myproject npm run pw:verify
//
// PW_HUB overrides the whole URL for hosts that don't match the dev.azure.com
// shape (e.g. Azure DevOps Server). The publisher segment is fixed because the
// contribution id comes from the published extension, not from your org.
const ORG = process.env.PW_ORG ?? "dataversepowertools";
const PROJECT = process.env.PW_PROJECT ?? "dataversepowertools";

export const HUB =
  process.env.PW_HUB ??
  `https://dev.azure.com/${ORG}/${PROJECT}/_apps/hub/dataversepowertools.powerwiki.wiki`;

// A dedicated profile OUTSIDE the repo (it holds session cookies — never commit
// it). Non-default dir is also required: Chrome blocks remote debugging on the
// real default profile, and App-Bound Encryption blocks copying its cookies.
export const PROFILE_DIR = path.join(os.homedir(), ".powerwiki-pw", "chrome-profile");
export const ARTIFACTS_DIR = path.join(import.meta.dirname, "artifacts");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Launches Chrome (system install, via channel) against the persistent profile. */
export async function launch({ headless = false } = {}) {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless,
    viewport: { width: 1600, height: 1000 },
    args: ["--hide-crash-restore-bubble"],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  // Callers attach their own dialog handler (verify needs to answer prompts with
  // specific values), so none is registered here.
  return { context, page };
}

/**
 * Waits for the PowerWiki extension iframe to be present and mounted. On a fresh
 * profile this also covers the sign-in wait (the caller passes a long timeout).
 */
export async function powerWikiFrame(page, { timeoutMs = 240000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const frame = page
      .frames()
      .find((f) => f.url().includes("/powerwiki/") && f.url().includes("powerwiki.html"));
    if (frame) {
      const mounted = await frame.$(".powerwiki-shell").catch(() => null);
      if (mounted) {
        return frame;
      }
    }
    if (/login\.microsoftonline|login\.live|\/oauth2|\/_signin|aadcdn/.test(page.url())) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      if (elapsed % 8 === 0) {
        console.log(`  waiting for Azure DevOps sign-in in the Chrome window... (${elapsed}s)`);
      }
    }
    await sleep(1000);
  }
  throw new Error("PowerWiki iframe not ready. If this is a fresh profile, run: npm run pw:auth");
}

/** Navigates to a wiki page (by hash) and returns its mounted iframe. */
export async function openWikiPage(page, hash, options) {
  await page.goto(HUB + hash, { waitUntil: "domcontentloaded" });
  return powerWikiFrame(page, options);
}

/** Reads the extension version shown in the header, e.g. "1.1.1". */
export async function readLoadedVersion(frame) {
  return frame
    .$eval(".powerwiki-brand span", (el) => (el.textContent || "").replace(/[^0-9.]/g, ""))
    .catch(() => "");
}
