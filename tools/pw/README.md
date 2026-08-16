# PowerWiki Playwright harness

Drives a published PowerWiki extension inside Azure DevOps for verification.
`PW_EXTENSION` selects which one, so this works against the private dev and canary
builds as well as the public release — see "Testing before release" in `AGENTS.md`.
Playwright can reach into PowerWiki's cross-origin iframe (DOM, console,
network) and save screenshots to disk — things a browser-extension automation
agent cannot do for a cross-origin extension iframe, because it only ever sees
the top frame.

## One-time setup

```powershell
npm install            # installs playwright-core (uses your system Chrome)
npm run pw:auth        # opens Chrome; sign in to Azure DevOps once
```

On a machine with **no system Chrome** — a headless Linux box, or CI — install
Playwright's own browser once instead:

```bash
npx playwright install chromium
```

The harness then picks it up with no further configuration. That build lands in
a per-version cache (`~/.cache/ms-playwright/chromium-<build>`), so several
projects on one machine can share it without competing over a single
auto-updating system browser. Note that a headless machine still cannot complete
the interactive sign-in below without a virtual display.

`pw:auth` launches a real Chrome window against a dedicated persistent profile
at `~/.powerwiki-pw/chrome-profile` and waits for you to complete Microsoft
sign-in (or for Windows SSO to auto-complete). The session persists there, so
later runs are unattended until it eventually expires — re-run `pw:auth` if
`pw:verify` reports it's waiting for sign-in.

Why a dedicated profile: Chrome blocks remote debugging on the real default
profile, and App-Bound Encryption blocks copying its cookies — so signing in to
a separate profile once is the reliable path.

## Point it at your organization

The harness drives the *published* Marketplace build, so it works against any
Azure DevOps organization that has PowerWiki installed and a wiki to read. It
defaults to the maintainer's org; override with environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PW_ORG` | `dataversepowertools` | Azure DevOps organization |
| `PW_PROJECT` | `PowerWiki` | Project containing the wiki |
| `PW_HUB` | *(derived)* | Full hub URL, for hosts that aren't `dev.azure.com` (e.g. Azure DevOps Server) |
| `PW_TEAM_ID` | *(PowerWiki Team)* | Identity GUID used by the `@mention` check |
| `PW_TEAM_NAME` | `PowerWiki Team` | Display name that GUID must resolve to |
| `PW_EXTENSION` | `powerwiki` | Which published build to drive: `powerwiki-canary` for the pre-release canary, `powerwiki-dev` for the working tree via `baseUri` |
| `PW_PUBLISHER` | `dataversepowertools` | Publisher segment of the contribution id |
| `PW_CHANNEL` | `chrome` | Browser to drive. Left unset it uses your system Chrome, falling back to Playwright's own build if there is none. Set `chromium` to require that build; any other value (`msedge`, ...) must be installed or the run fails. |

```powershell
$env:PW_ORG="myorg"; $env:PW_PROJECT="myproject"; npm run pw:verify
```

The publisher segment of the hub URL is fixed, because the contribution id comes
from the published extension rather than from your organization.

Note that `verify.mjs` asserts against specific wiki content (a `Home` page with
a work-item reference and an embedded query table, and a `PowerWiki Showcase`
page). Against a different wiki, expect those content-specific checks to fail
until you adapt them.

## Verify a build

```powershell
npm run pw:verify
```

Asserts, inside the iframe: work-item/query enrichment on load, byline
author/date, enrichment surviving Home → Showcase → Home navigation, and that an
uploaded image actually renders (which also proves the attachments API base64
body is correct). Screenshots and `summary.json` land in `tools/pw/artifacts/`
(gitignored). Exit code is non-zero if any check fails.

The upload check creates a small `pw-smoke-*.png` under the wiki's
`.attachments` folder each run; delete those occasionally if they accumulate.

## Notes

- The persistent profile holds session cookies — it lives outside the repo and
  must never be committed.
- Prefer this harness over ad-hoc browser clicking when verifying rendering or
  editing behavior, because it can assert on the extension's real DOM.
