// One-time sign-in for the Playwright harness.
//
// Opens a real Chrome window against the dedicated persistent profile and waits
// for you to complete Azure DevOps sign-in (or for Windows SSO to auto-complete).
// With PW_AUTH_USER and PW_AUTH_PASSWORD set it signs in by itself, headless
// unless PW_HEADED=1 (see signIn.mjs for what it will and will not answer).
// After it succeeds, the session is stored in the profile and pw:verify can run
// unattended until the session eventually expires. Re-run this if verify starts
// reporting that it's waiting for sign-in.
import { HUB, launch, powerWikiFrame, PROFILE_DIR } from "./lib.mjs";
import { hasSignInCredentials } from "./signIn.mjs";

const unattended = hasSignInCredentials();
const { context, page } = await launch({ headless: unattended && process.env.PW_HEADED !== "1" });
console.log(`Profile: ${PROFILE_DIR}`);
console.log(
  unattended
    ? "Opening PowerWiki — signing in with PW_AUTH_USER / PW_AUTH_PASSWORD if prompted..."
    : "Opening PowerWiki — complete the Microsoft sign-in in the window if prompted..."
);

try {
  await page.goto(`${HUB}#/Home`, { waitUntil: "domcontentloaded" });
  await powerWikiFrame(page, { timeoutMs: 540000 });
  console.log("Signed in. Session saved to the persistent profile — you can close this now.");
} catch (error) {
  console.error(`Auth failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close();
}
