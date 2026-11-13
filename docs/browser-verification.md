# Verifying in the browser with Playwright (reference)

The `tools/pw/` harness, its setup, and the Chromium crash findings.

PowerWiki runs inside a cross-origin iframe (`gallerycdn.vsassets.io`) hosted in
`dev.azure.com`. Browser-extension automation can only see the top frame, so it
cannot read the extension iframe's DOM, console, or network, and its screenshots
don't reach the repo filesystem. Use the Playwright harness in `tools/pw/`
instead — Playwright treats the cross-origin iframe as a first-class frame, so it
can assert on the real rendered DOM, capture iframe console/network, and save
screenshots locally. Prefer it for verifying rendering and editing behavior.

The harness runs against whichever build you point it at, so it does **not**
require a public release — see "Testing before release":

```bash
npm run pw:verify                                  # public powerwiki
PW_EXTENSION=powerwiki-canary npm run pw:verify    # the pre-release canary
```

`PW_EXTENSION` works because the hub URL embeds the contribution id
(`<publisher>.<extension-id>.wiki`), so each build has its own URL. `PW_ORG`,
`PW_PROJECT`, `PW_PUBLISHER`, and `PW_HUB` override the rest.

A change that alters `scopes` pauses at "Pending review" until an org admin
approves it in Organization settings → Extensions. That applies to the private
variants too, so expect one consent step the first time each is installed.

Setup and use (details in `tools/pw/README.md`):

1. `npm install` (adds `playwright-core`, which drives your installed Chrome).
2. `npm run pw:auth` once — opens Chrome against a dedicated persistent profile
   at `~/.powerwiki-pw`; sign in to Azure DevOps in that window. The session
   persists there for later runs. A dedicated profile is required because Chrome
   blocks remote debugging on the real default profile and App-Bound Encryption
   blocks copying its cookies, so signing in to a separate profile once is the
   reliable path. This profile holds session cookies — never commit it.
3. `npm run pw:verify` — asserts, inside the iframe, that work-item/query
   enrichment and the byline load, that enrichment survives page navigation, and
   that an uploaded image renders. Artifacts land in `tools/pw/artifacts/`
   (gitignored). Re-run `pw:auth` if verify reports it is waiting for sign-in.
4. Unattended: with `PW_AUTH_USER` and `PW_AUTH_PASSWORD` in the environment,
   `pw:auth` signs in by itself (headless), and `pw:verify` signs back in once if
   the session has expired. `tools/pw/signIn.mjs` answers only the account,
   password and "Stay signed in?" prompts, choosing the password route over a
   code; a code, app approval, password change or security-details prompt stops
   the run with the page's title. The values are only handed to `fill()`: never
   logged, never in an error, no screenshot while a sign-in page shows. Keep them
   in the environment only, never on a command line or in a file.
5. Account picker only: with `PW_AUTH_USER` set and **no** `PW_AUTH_PASSWORD`,
   a profile that is still signed in to Microsoft is re-selected without typing
   anything. The run clicks that account's tile on "Pick an account" and answers
   "Stay signed in?"; a prompt for an account name or a password stops it. This
   suits a maintainer desktop where the Azure DevOps session expires but the
   Microsoft sign-in in the profile does not.

Extend `tools/pw/verify.mjs` with a new assertion whenever you add a feature
worth guarding, so the harness doubles as a regression smoke test.

**Chromium 1243 segfaults on the download path, intermittently.** Measured with
`DEBUG=pw:browser*`: the *browser* process dies with `Received signal 11
SI_KERNEL` and `<process did exit: signal=SIGSEGV>` during the Word export
download, killing the run mid-suite. It is not deterministic — the same build
completed a full run the same day — and it is not the product: a fresh-profile
repro exported the same page three times without incident, and the crash
reproduces against the *published* build as readily as a new one.

Three things follow, all already in the harness:

- **`pw:verify` runs headless.** The crash is in the browser process's download
  UI, and headless has none; `PW_HEADED=1` opens a window in a virtual display session
  when you want to watch. `pw:auth` stays headed, because signing in needs a
  real window. Disabling `DownloadBubble`/`DownloadBubbleV2` and passing
  `--disable-dev-shm-usage` came first and was **not** enough on its own - a run
  crashed in the same place immediately afterwards, so do not treat those flags
  as the fix.
- A lost browser is reported **once**, as an infrastructure crash rather than a
  product failure. Without that it cascades: every later step fails with the
  same "target closed" message and the run reads as a dozen regressions, which
  is exactly how it sent one investigation chasing a Mermaid upgrade.
- `sweepSmokeAttachments` deletes `pw-smoke-*` leftovers **at the start** of a
  run. End-of-run cleanup goes through the browser's own request context, so a
  crash takes the cleanup with it and the uploads stay in the wiki — six of them
  accumulated in one afternoon before this existed. Note that cleanup deletes by
  *pushing a commit* to the wiki repository, which is why it can remove an
  attachment at all: the wiki attachments API is create-only, git is not.

## Cloud canary release gate

Before a public Marketplace release, run the harness against the private
`powerwiki-canary` in Azure DevOps **Services**. Do not substitute an Azure
DevOps Server result: the cloud host, extension CDN, and authentication path
are separate compatibility targets.

```powershell
$env:PW_EXTENSION = "powerwiki-canary"
# Use the Services organization/project fixture. Do not set PW_HUB to a Server URL.
npm run pw:auth
npm run pw:verify
```

Record the installed canary version, organization/project, browser, and result.
The run must have no failed assertions. For token-safe attachment loading, its
required checks are:

- The crafted `data-powerwiki-image` target is stripped and never requested.
- A normal wiki attachment renders through the authenticated Git Items path,
  including an attachment thumbnail.
- A stored draw.io diagram still opens, so the same guard covers its data-URL
  loading path.
- An ordinary external image remains a normal unauthenticated browser image.
- Record whether a successful cloud Git Items attachment request redirects. If
  it does, do not relax `redirect: "error"` or ship a redirect-following
  workaround until every redirect destination is independently validated before
  a bearer token can be sent.

These checks validate both halves of the security boundary: author-controlled
URLs cannot select the token destination, while host-generated attachment URLs
continue to work. A passing Server canary does not waive this Services gate, and
a passing Services canary does not waive Server coverage for Server-specific
changes.
