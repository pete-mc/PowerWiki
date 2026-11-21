// Shared Playwright helpers for driving PowerWiki inside Azure DevOps.
//
// PowerWiki renders in a cross-origin iframe (gallerycdn.vsassets.io) inside
// dev.azure.com. Playwright can reach into that frame (DOM, console, network),
// which a browser-extension automation agent cannot. Auth is handled once by signing
// in to a dedicated persistent Chrome profile (see auth.mjs); every later run
// reuses that profile's cookies. See tools/pw/README.md and AGENTS.md.
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

import { hasSignInCredentials, isAccountPickerOnly, isOnSignInPage, signIn } from "./signIn.mjs";

// Which Azure DevOps organization/project to drive, and which published
// extension. Point it at any org that has the extension installed and a wiki to
// read:
//
//   PW_ORG=myorg PW_PROJECT=myproject npm run pw:verify
//
// PW_EXTENSION selects which build to verify. The hub URL contains the
// contribution id, which is `<publisher>.<extension-id>.<contribution>`, so the
// private canary build lives at a different URL from the public one:
//
//   npm run pw:verify                        # public powerwiki
//   PW_EXTENSION=powerwiki-canary npm run pw:verify
//
// PW_HUB still overrides the whole URL for hosts that don't match the
// dev.azure.com shape (e.g. Azure DevOps Server). API calls derive their
// collection URL from it, preserving a Server collection and virtual directory.
export const ORG = process.env.PW_ORG ?? "dataversepowertools";
const DEFAULT_PROJECT = "PowerWiki";
const PUBLISHER = process.env.PW_PUBLISHER ?? "dataversepowertools";
const EXTENSION = process.env.PW_EXTENSION ?? "powerwiki";

export const HUB =
  process.env.PW_HUB ??
  `https://dev.azure.com/${ORG}/${process.env.PW_PROJECT ?? DEFAULT_PROJECT}/_apps/hub/${PUBLISHER}.${EXTENSION}.wiki`;

const hubMatch = new URL(HUB).pathname.match(/^(.*)\/([^/]+)\/_apps\/hub\//);
const hubUrl = new URL(HUB);

// PW_PROJECT remains useful when a custom hub has an unusual shape, but a
// normal hub URL supplies the right project on both Services and Server.
export const PROJECT = process.env.PW_PROJECT ?? hubMatch?.[2] ?? DEFAULT_PROJECT;
export const COLLECTION_URL =
  process.env.PW_COLLECTION_URL ??
  (hubMatch ? `${hubUrl.origin}${hubMatch[1]}` : `https://dev.azure.com/${ORG}`);

// Which browser binary to drive. Defaults to the system Chrome install, which
// is what a maintainer desktop has. Set PW_CHANNEL=chromium on a machine with
// no system Chrome (the headless Linux VM) to drive the Playwright-managed
// build in ~/.cache/ms-playwright instead; that cache is namespaced per
// Playwright release, so projects on different versions can share it safely.
const CHANNEL = process.env.PW_CHANNEL || "chrome";
const CHANNEL_IS_EXPLICIT = Boolean(process.env.PW_CHANNEL);

// A dedicated profile OUTSIDE the repo (it holds session cookies — never commit
// it). Non-default dir is also required: Chrome blocks remote debugging on the
// real default profile, and App-Bound Encryption blocks copying its cookies.
export const PROFILE_DIR = path.join(os.homedir(), ".powerwiki-pw", "chrome-profile");
export const ARTIFACTS_DIR = path.join(import.meta.dirname, "artifacts");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A small `context.request`-compatible adapter that makes same-origin requests
 * from the rendered Azure DevOps page. Unlike Playwright's request context, it
 * carries Windows Integrated Authentication on Azure DevOps Server.
 */
export function browserRequestContext(page) {
  const request = async (url, init = {}) => {
    const result = await page.evaluate(
      async ({ requestUrl, requestInit }) => {
        const response = await fetch(requestUrl, { ...requestInit, credentials: "include" });
        return { ok: response.ok, status: response.status, body: await response.text() };
      },
      { requestUrl: url, requestInit: init }
    );
    return {
      ok: () => result.ok,
      status: () => result.status,
      json: async () => JSON.parse(result.body),
      text: async () => result.body
    };
  };
  return {
    request: {
      get: (url) => request(url),
      post: (url, { headers, data }) =>
        request(url, { method: "POST", headers, body: JSON.stringify(data) })
    }
  };
}

/** Launches the browser (system Chrome, or PW_CHANNEL) against the persistent profile. */
export async function launch({ headless = false } = {}) {
  const options = {
    headless,
    viewport: { width: 1600, height: 1000 },
    // DownloadBubble is off because Chromium 1243 (Chrome 153) segfaults in the
    // *browser* process on the download path - `Received signal 11 SI_KERNEL`,
    // `signal=SIGSEGV` - which kills the run mid-suite and takes the cleanup
    // with it. It is intermittent (the same build completed a full run the same
    // day), so this is a mitigation of the download UI rather than a proven
    // cure; keep the crash handling in verify.mjs regardless.
    args: [
      "--hide-crash-restore-bubble",
      "--disable-features=DownloadBubble,DownloadBubbleV2",
      "--disable-dev-shm-usage",
    ],
  };
  // The Playwright-managed build is selected by omitting channel entirely, not
  // by passing "chromium" as a channel name.
  const requested = CHANNEL === "chromium" ? options : { ...options, channel: CHANNEL };

  let context;
  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, requested);
  } catch (error) {
    // On a machine with no system Chrome (the headless Linux VM, CI) Playwright
    // fails here advising `npx playwright install chrome`, which on Linux is a
    // global apt install. Prefer its own per-version build from
    // `npx playwright install chromium` instead, which several projects can
    // share without fighting over one auto-updating system browser.
    // Only the default falls back. A channel you asked for by name fails loudly,
    // rather than quietly testing against a browser you did not choose.
    const missing = /is not found|Executable doesn't exist/.test(error.message);
    if (CHANNEL_IS_EXPLICIT || !missing) {
      throw error;
    }
    console.warn(`No "${CHANNEL}" install found - using the Playwright-managed Chromium.`);
    context = await chromium.launchPersistentContext(PROFILE_DIR, options);
  }
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
  let triedSignIn = false;
  while (Date.now() - start < timeoutMs) {
    // Identify the frame by the mounted shell, not by its URL. The URL shape
    // differs per build in ways that are easy to get wrong: the public build is
    // served from the gallery CDN under /<extension-id>/, while a PRIVATE build
    // (dev and canary) is served from a `privateasset/<token>` URL containing
    // neither the file name nor the id in a stable position. The shell is the one
    // invariant across all three, and waiting for it stays a positive assertion
    // that the app actually mounted rather than an inference from a URL.
    for (const candidate of page.frames()) {
      const mounted = await candidate.$(".powerwiki-shell").catch(() => null);
      if (mounted) {
        return candidate;
      }
    }
    if (isOnSignInPage(page)) {
      // The session in the profile expires; sign back in unattended when the
      // credentials are available, rather than waiting on a person. Once only:
      // a sign-in that did not take is a failure to report, not to retry.
      if (hasSignInCredentials() && !triedSignIn) {
        triedSignIn = true;
        console.log(
          isAccountPickerOnly()
            ? "  choosing the PW_AUTH_USER account on the Microsoft account picker..."
            : "  signing in to Azure DevOps with PW_AUTH_USER / PW_AUTH_PASSWORD..."
        );
        await signIn(page);
        continue;
      }
      const elapsed = Math.round((Date.now() - start) / 1000);
      if (elapsed % 8 === 0) {
        console.log(`  waiting for Azure DevOps sign-in in the Chrome window... (${elapsed}s)`);
      }
    }
    await sleep(1000);
  }
  throw new Error("PowerWiki iframe not ready. If this is a fresh profile, run: npm run pw:auth");
}

/**
 * Deletes attachments the run uploaded, so the wiki does not accumulate one
 * `pw-smoke-*` file per verify forever. The upload tests are the only thing that
 * writes to /.attachments, and nothing reads them afterwards.
 *
 * Uses a browser-backed request context, so this needs no token of its own and
 * carries Windows Integrated Authentication on Azure DevOps Server. There is no
 * REST call to delete a wiki attachment —
 * attachments are files in the wiki's Git repository — so it is one push with a
 * delete change per file. Best effort by design: a failure here must never fail
 * an otherwise passing verify, so it reports and moves on.
 */
/**
 * Deletes smoke-test attachments left behind by *earlier* runs.
 *
 * The end-of-run cleanup goes through the browser's authenticated request
 * context, so a browser crash takes the cleanup with it and the uploads stay in
 * the wiki - which is how six of them accumulated in one afternoon. Sweeping at
 * the start means the next run tidies up after the last one, whatever killed
 * it, and a crash costs nothing permanent.
 */
export async function sweepSmokeAttachments(context) {
  try {
    const api = context.request;
    const wikis = await api.get(`${COLLECTION_URL}/${PROJECT}/_apis/wiki/wikis?api-version=7.1`);
    const all = (await wikis.json()).value;
    const wiki = all.find((w) => w.type === "projectWiki") ?? all[0];
    const items = await api.get(
      `${COLLECTION_URL}/_apis/git/repositories/${wiki.repositoryId}/items?scopePath=/.attachments&recursionLevel=oneLevel&api-version=7.1`
    );
    if (!items.ok()) {
      return;
    }
    const stale = ((await items.json()).value ?? [])
      .map((item) => item.path)
      .filter((item) => /\/\.attachments\/pw-smoke-/.test(item));
    if (stale.length === 0) {
      return;
    }
    console.log(`sweeping ${stale.length} attachment(s) left by an earlier run`);
    await deleteAttachments(context, stale);
  } catch (error) {
    console.log(`attachment sweep skipped (${error.message})`);
  }
}

/** The project's wiki with this name, or undefined when there is none. */
export async function findWiki(context, name) {
  const wikis = await context.request.get(`${COLLECTION_URL}/${PROJECT}/_apis/wiki/wikis?api-version=7.1`);
  return ((await wikis.json()).value ?? []).find((w) => w.name === name);
}

/**
 * Deletes uploaded attachments (repository paths) from the project wiki, or
 * from the named wiki when `wikiName` is given.
 */
export async function deleteAttachments(context, paths, wikiName) {
  if (!paths.length) {
    return;
  }
  try {
    const api = context.request;
    const wikis = await api.get(`${COLLECTION_URL}/${PROJECT}/_apis/wiki/wikis?api-version=7.1`);
    const all = (await wikis.json()).value;
    const wiki = wikiName ? all.find((w) => w.name === wikiName) : all.find((w) => w.type === "projectWiki") ?? all[0];
    // A project wiki's repository id is the wiki id, and its branch is whatever
    // the wiki was provisioned with (wikiMaster on older projects, main on newer).
    // A code wiki's branch is the one it is published from.
    const branch = (wiki.versions?.[0]?.version) ?? "wikiMaster";
    const refs = await api.get(
      `${COLLECTION_URL}/_apis/git/repositories/${wiki.repositoryId}/refs?filter=heads/${branch}&api-version=7.1`
    );
    const head = (await refs.json()).value[0];
    const push = await api.post(`${COLLECTION_URL}/_apis/git/repositories/${wiki.repositoryId}/pushes?api-version=7.1`, {
      headers: { "Content-Type": "application/json" },
      data: {
        refUpdates: [{ name: `refs/heads/${branch}`, oldObjectId: head.objectId }],
        commits: [
          {
            comment: `Remove ${paths.length} smoke-test attachment(s)`,
            changes: paths.map((item) => ({ changeType: "delete", item: { path: item } })),
          },
        ],
      },
    });
    console.log(
      push.ok()
        ? `cleaned up ${paths.length} uploaded attachment(s)`
        : `attachment cleanup failed (${push.status()}); leaving ${paths.join(", ")}`
    );
  } catch (error) {
    console.log(`attachment cleanup failed (${error.message}); leaving ${paths.join(", ")}`);
  }
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

/**
 * Hides the maintainer's own canary build from the page before a marketplace
 * screenshot.
 *
 * It is a private extension with a different id, shared only with this
 * organization, so no customer has it — but it is installed here, which puts a
 * second "Power Wiki" entry in the project nav and a second "Power Wiki" tab on
 * the work item form. A store screenshot showing those advertises something
 * nobody can install and makes the real one look ambiguous.
 *
 * This is presentation only, and only for captures: it hides nodes in the page
 * being photographed rather than changing what is installed. Disabling the
 * extension for real would be an organization-wide change affecting anyone else
 * using them, to make a picture look right.
 *
 * Match on the visible label rather than an id: the contribution ids are
 * generated per install, whereas the "(Canary)" suffix is set by
 * `tools/release/variant-manifest.mjs` and is the whole reason the variant is
 * distinguishable in the first place. "(Dev)" is still matched for an
 * organization that has the retired dev extension installed.
 */
export async function hideVariantBuilds(page) {
  const hidden = await page.evaluate(() => {
    const isVariant = (element) => /\(Dev\)|\(Canary\)/.test((element.textContent || "").trim());
    const selectors = [
      "a.hub-group",        // project nav entry for a hub contribution
      '[role="tab"]',       // work item form pivot
    ];
    let count = 0;
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (isVariant(element)) {
          element.style.display = "none";
          count += 1;
        }
      }
    }
    return count;
  });
  return hidden;
}
