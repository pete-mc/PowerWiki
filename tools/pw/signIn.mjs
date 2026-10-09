// Unattended Microsoft sign-in for the Playwright harness.
//
// The harness's browser profile holds an Azure DevOps session, and that session
// does not last: it can expire within the hour. When PW_AUTH_USER and
// PW_AUTH_PASSWORD are set, this answers the ordinary sign-in prompts (account,
// password, "Stay signed in?") so a run can sign itself back in.
//
// It answers nothing else. A one-time code, an app approval, a password change
// or a request for security details is a person's decision, so it stops and
// says which prompt it met. The values are only ever handed to `fill()`: never
// logged, never put in an error message, and no screenshot is taken while a
// sign-in page is showing.

const SIGN_IN_URL = /login\.microsoftonline|login\.live|\/oauth2|\/_signin|aadcdn/;

// Prompts that need a person. Matched against the page's visible text.
const NEEDS_A_PERSON = [
  [/enter (the )?code|verification code|we sent a code|security code/i, "a one-time code"],
  [/approve (the )?(sign[- ]in )?request|open your authenticator|check your authenticator/i, "an app approval"],
  [/update your password|password has expired|change your password|create a new password/i, "a password change"],
  [/help us protect your account|more information required|security info|verify your identity/i, "security details"],
  [/account (has been )?(locked|blocked)|unusual activity/i, "a locked or blocked account"],
];

export function hasSignInCredentials() {
  return Boolean(process.env.PW_AUTH_USER && process.env.PW_AUTH_PASSWORD);
}

export function isOnSignInPage(page) {
  return SIGN_IN_URL.test(page.url());
}

/**
 * Answers the sign-in prompts on `page` until it leaves the sign-in pages.
 * Throws, without any credential in the message, when it meets a prompt that
 * needs a person or a page it does not recognise.
 */
export async function signIn(page, { timeoutMs = 120000 } = {}) {
  const user = process.env.PW_AUTH_USER;
  const password = process.env.PW_AUTH_PASSWORD;
  if (!user || !password) {
    throw new Error("Sign-in needs PW_AUTH_USER and PW_AUTH_PASSWORD.");
  }

  const start = Date.now();
  let idleSince = Date.now();
  const followed = new Set();
  while (Date.now() - start < timeoutMs) {
    if (!isOnSignInPage(page)) {
      return;
    }

    // A personal Microsoft account may offer to send a code first ("Get a code
    // to sign in"), with the password behind "Other ways to sign in". Choosing
    // the password is not answering the code prompt; nothing is sent. Each link
    // is followed once, so an account with no password route stops below.
    let choseMethod = false;
    for (const [name, pattern] of [
      ["password", /^\s*(use your password|sign in with (a|your) password)\s*$/i],
      ["other ways", /^\s*other ways to sign in\s*$/i],
    ]) {
      const link = page.getByText(pattern).first();
      if (!followed.has(name) && (await link.isVisible().catch(() => false))) {
        followed.add(name);
        await link.click();
        choseMethod = true;
        break;
      }
    }
    if (choseMethod) {
      idleSince = Date.now();
      await page.waitForTimeout(1500);
      continue;
    }

    const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    for (const [pattern, what] of NEEDS_A_PERSON) {
      if (pattern.test(text)) {
        throw new Error(
          `Microsoft sign-in asked for ${what}; that needs a person, so it was not answered ` +
            `(${await describePage(page, user)}).`
        );
      }
    }

    if (await answerPrompt(page, user, password)) {
      idleSince = Date.now();
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForTimeout(1500);
      continue;
    }

    // Redirects between sign-in pages show nothing to answer for a moment;
    // only a page that stays unrecognised is a failure.
    if (Date.now() - idleSince > 20000) {
      throw new Error(`Microsoft sign-in showed a page it does not recognise (${await describePage(page, user)}).`);
    }
    await page.waitForTimeout(1000);
  }
  throw new Error("Microsoft sign-in did not finish in time.");
}

/**
 * Enough of a sign-in page to tell which prompt it was: the title and the main
 * heading, with the account name masked so it never reaches a log.
 */
async function describePage(page, user) {
  const title = await page.title().catch(() => "");
  const heading = await page
    .locator('h1, h2, [role="heading"]')
    .first()
    .innerText({ timeout: 2000 })
    .catch(() => "");
  const mask = (value) => value.split(user).join("<account>").replace(/\s+/g, " ").trim().slice(0, 120);
  return `title: ${JSON.stringify(mask(title))}, heading: ${JSON.stringify(mask(heading))}`;
}

/** Answers the one prompt on screen, if it is one of ours. Returns whether it did. */
async function answerPrompt(page, user, password) {
  const visible = async (selector) => page.locator(selector).first().isVisible().catch(() => false);
  const submit = async () => {
    for (const selector of ['button[data-testid="primaryButton"]', "#idSIButton9", 'input[type="submit"]', 'button[type="submit"]']) {
      if (await visible(selector)) {
        await page.locator(selector).first().click();
        return true;
      }
    }
    await page.keyboard.press("Enter");
    return true;
  };
  const fill = async (selector, value) => {
    try {
      await page.locator(selector).first().fill(value, { timeout: 10000 });
    } catch {
      // Playwright's own message could describe the call; replace it.
      throw new Error("Could not fill a Microsoft sign-in field.");
    }
  };

  // "Stay signed in?" - yes, so the profile keeps the session as long as it can.
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (/stay signed in/i.test(text)) {
    return submit();
  }

  // Account picker: choose the configured account, never another one.
  if (/pick an account|choose an account/i.test(text)) {
    const tiles = page.locator('[role="listitem"], [role="button"], .table, [data-test-id]');
    const count = await tiles.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const tile = tiles.nth(index);
      const label = (await tile.innerText().catch(() => "")).toLowerCase();
      if (label.includes(user.toLowerCase()) && (await tile.isVisible().catch(() => false))) {
        await tile.click();
        return true;
      }
    }
    const other = page.getByText(/use another account/i).first();
    if (await other.isVisible().catch(() => false)) {
      await other.click();
      return true;
    }
    return false;
  }

  if (await visible('input[type="password"]')) {
    await fill('input[type="password"]', password);
    return submit();
  }

  if (await visible('input[type="email"], input[name="loginfmt"]')) {
    await fill('input[type="email"], input[name="loginfmt"]', user);
    return submit();
  }

  return false;
}
