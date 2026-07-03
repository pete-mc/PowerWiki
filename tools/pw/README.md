# PowerWiki Playwright harness

Drives the published PowerWiki extension inside Azure DevOps for verification.
Playwright can reach into PowerWiki's cross-origin iframe (DOM, console,
network) and save screenshots to disk — things the Claude-in-Chrome browser
tools can't do for a cross-origin extension iframe.

## One-time setup

```powershell
npm install            # installs playwright-core (uses your system Chrome)
npm run pw:auth        # opens Chrome; sign in to Azure DevOps once
```

`pw:auth` launches a real Chrome window against a dedicated persistent profile
at `~/.powerwiki-pw/chrome-profile` and waits for you to complete Microsoft
sign-in (or for Windows SSO to auto-complete). The session persists there, so
later runs are unattended until it eventually expires — re-run `pw:auth` if
`pw:verify` reports it's waiting for sign-in.

Why a dedicated profile: Chrome blocks remote debugging on the real default
profile, and App-Bound Encryption blocks copying its cookies — so signing in to
a separate profile once is the reliable path.

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
