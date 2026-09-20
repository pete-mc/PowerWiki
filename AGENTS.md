# Agents Guide

This repository is for PowerWiki, an Azure DevOps extension that adds a Power Wiki menu experience alongside the default Azure DevOps Wiki while continuing to use the standard Azure DevOps Wiki repositories as the backing store.

## Agent instruction files

This file is the authoritative guide for **every** AI agent and human working in this repository, and it is meant to stay tool-neutral. `AGENTS.md` is the cross-tool convention, so keep the guidance here and add per-tool files only as thin pointers to it — `CLAUDE.md` is exactly that and holds no guidance of its own. Duplicated instructions drift apart, and then whichever copy an agent happens to load wins.

Machine-specific notes (provisioned tool versions, local credential paths, how a browser or display is launched on one box) do not belong here. They go in an untracked `CLAUDE.local.md` / `AGENTS.local.md`, which `.gitignore` covers. The test: if a note would also be true on another contributor's machine, it belongs in this file.

## Where things live

| Concern | Location |
| --- | --- |
| Source code (authoritative) | <https://github.com/pete-mc/PowerWiki> — public, MIT, `origin` |
| CI | GitHub Actions: `ci.yml` (test + build), `codeql.yml`, `dependency-review.yml` |
| Releases | `release.yml` — a `v*` tag publishes to the Marketplace and creates a GitHub Release |
| Backlog / planning | Azure Boards, **PowerWiki** project: `dev.azure.com/dataversepowertools/PowerWiki` |
| Test & showcase wiki | The **PowerWiki** project's wiki (`PowerWiki.wiki`) |
| Marketplace listing | Publisher `dataversepowertools`, extension `powerwiki` |

Code is public; the backlog stays on Azure Boards. Link commits and pull requests to work items with `AB#<id>` mentions (an Azure Boards ↔ GitHub connection is configured on the PowerWiki project) rather than duplicating the backlog into GitHub Issues — GitHub Issues is public intake for bug reports and feature requests. Contributor-facing build/test instructions live in `CONTRIBUTING.md`.

The old Azure DevOps code repository (in the `dataversepowertools` project) is **disabled** — do not push there. The old project's wiki still exists as a migration backup but is no longer the one under test.

## Product direction and constraints

PowerWiki should feel like the normal Azure DevOps Wiki, with an upgraded Markdown and Mermaid experience, and must not remove, hide, or disable the built-in wiki experience. It should:

- Preserve feature parity with the built-in wiki wherever extension APIs allow, and treat Azure DevOps Wiki as the system of record.
- Use the existing Azure DevOps Wiki Git repositories as the source of truth, storing content as normal Markdown and wiki assets — no custom page formats or storage that would lock teams into PowerWiki.
- Support current Markdown behavior through a maintainable CommonMark/GFM pipeline, and current Mermaid diagrams through an upgradeable integration.
- Support browsing, rendering, create/edit/rename/move/delete, preview before save, and preserve links, attachments, images and relative paths.
- Expose history, revision, compare and search workflows where the extension APIs support them, and make unsupported parity gaps explicit in docs/tests.
- Prefer official Azure DevOps extension SDKs and REST APIs; keep renderer code separated from Azure DevOps data access and UI state; do not introduce a backend service unless the requirement cannot reasonably be met inside an extension.

## Two hosts, one UI

PowerWiki runs in the Azure DevOps hub and in a VS Code extension that works off a cloned wiki repository (`vscode/`, sources in `src/vscode/`). Both render the same React app. The rule to defend:

> **Nothing under `src/app/`, `src/rendering/`, or `src/export/` may import a
> host SDK.** Everything host-specific goes through `WikiHost`
> (`src/host/WikiHost.ts`), and each host implements it.

- Three implementations: `src/host/azureDevOpsWikiHost.ts`, `src/vscode/webview/VsCodeWikiHost.ts`, `src/sandbox/sandboxWikiHost.ts`. Add a feature once, above the interface; never `if (runningInVsCode)`.
- **Capabilities, not sniffing.** `WikiHostCapabilities` says what a host can do; the UI omits what is unavailable rather than rendering a disabled button.
- **Webview traps** (`window.confirm`/`prompt`/`alert` silently fail, nothing relative resolves, `postMessage` is not queued, no downloads or printing, `ArrayBuffer` does not survive `postMessage`), the local wiki client, and the VS Code test suite (`npm run test:vscode`) are all in [`docs/two-hosts.md`](docs/two-hosts.md). Read it before touching `src/vscode/`.

## Theming

PowerWiki should follow the active Azure DevOps theme rather than defining an independent visual theme. Keep app colors behind the `--pw-*` design tokens in `src/app/styles.css`, and map those tokens to Azure DevOps CSS variables injected by the host wherever possible. Prefer transparent surfaces and neutral translucent borders/hovers so light, dark, and custom Azure DevOps themes remain legible.

Theme mode detection lives in `src/app/themeMode.ts`. It infers light or dark mode from the luminance of host CSS variables such as `--background-color` and `--text-primary-color`, not from theme names, and updates on `themeApplied` and `themeChanged` events. Monaco should switch between `vs` and `vs-dark`, and Mermaid should be re-rendered with the matching Mermaid theme when the host theme changes. Verify regular UI chrome, Markdown preview, editor chrome and Mermaid diagrams in both light and dark themes when changing theming; a hard-coded color should stay scoped to semantic states such as destructive actions or warnings.

## Code organization

Separate clear responsibilities (manifest and host wiring, API clients, wiki model, Markdown and Mermaid rendering, editor/preview/navigation UI, shared UI, tests, build scripts). No large files mixing UI, API access, rendering and state; no catch-all `helpers`/`utils`/`common`; centralize only after a real second use. Renderer behavior is pinned by fixtures in `src/rendering/*.test.ts` so Markdown and Mermaid upgrades are deliberate. Run `npm test` before publishing and `npm run pw:verify` for end-to-end checks. Detail: [`docs/code-organization.md`](docs/code-organization.md).

Update `README.md` when the project gains concrete setup, build, packaging, or publishing steps, and document any behavior that differs from the built-in Azure DevOps Wiki, especially where it affects stored Markdown, links, attachments, permissions, or page history.

Prefer **anchored** `.gitignore` paths (`/dist/`, `/media/screenshots/`): an unanchored name matches at every depth, and a trailing slash does not match a symlink. Run `git status` after changing an ignore rule, and `git check-ignore -v <path>` when the answer surprises you. Details: [`docs/gitignore-pitfalls.md`](docs/gitignore-pitfalls.md).

## Azure DevOps constraints that have already cost real time

Full measured findings: [`docs/azure-devops-constraints.md`](docs/azure-devops-constraints.md). Read the relevant part before working in that area. Headlines:

- The wiki **attachments API is create-only**; don't re-litigate it or take `vso.code_write` to work around it (re-approval in every organization).
- **Wiki search** is `almsearch.dev.azure.com` and reports an unready index as HTTP 200 + `count: 0`; surface the `infoCode`, never "no results". Snippets never reach `innerHTML`.
- The **work item form tab** cannot have an icon and must **never write the browser's URL** (`getNavigation()` is `undefined` there). Don't re-open without a new measurement.
- **Rendered DOM read back is unsanitized**: validate by replacing the value with the parsed one (`toSafeImageUrl`).
- **`npm run build` does not type-check** (esbuild-loader); gate on `npm test` (`tsc --noEmit` + Vitest). Node 24.15+. markdown-it 15: import types from the package root.
- Mermaid is a lazy chunk with `publicPath: "auto"`: no single-chunk limit, no runtime-chunk split; re-check with `npm run pw:verify` after webpack changes. The three known webpack warnings are expected.

## Testing before release

**Do not publish to the public Marketplace in order to test a change.** There is no staged rollout: 20+ organizations auto-update within minutes and a version number can never be republished. Use the cheapest layer that catches the bug ([`docs/testing-layers.md`](docs/testing-layers.md)):

1. **Sandbox** — `npm run dev:sandbox`, `npm run test:e2e` (in CI). Blind to REST contracts, permissions, host services and CDN paths.
2. **Dev extension** — private `powerwiki-dev`, `baseUri` `https://localhost:3000`, `npm run dev:extension`. A new manifest contribution needs the extension removed and reinstalled. Stop the server with Ctrl+C and check for orphaned `webpack --watch` processes (`ps -eo pid,etime,cmd | grep '[w]ebpack'`).
3. **Canary** — private `powerwiki-canary` from every push to `main`; `PW_EXTENSION=powerwiki-canary npm run pw:verify`.

Variants **must** use a different extension id from public `powerwiki` (`tools/release/assert-private.mjs` enforces it) and be relabelled.

## Publishing

Both extensions ship from one version number and one commit; details, PAT scopes and the failed-publish traps are in [`docs/publishing.md`](docs/publishing.md).

- Bump the version identically in `package.json`, `vss-extension.json` **and** `vscode/package.json`. Patch for fixes/docs/listing; minor for user-visible features; major only for a break in page storage or permissions.
- Run `npm test`, commit, tag **both** `v<version>` and `vscode-v<version>` (annotated), then `git push origin main --follow-tags`. Tags trigger `release.yml` (hub) and `release-vscode.yml` (VS Code).
- The tag prefix is load-bearing: `release.yml` matches `v[0-9]*`; do not loosen it to `v*`. A `-pre` suffix on a `vscode-v` tag publishes to the pre-release channel.
- **A failed publish does not mean nothing was published.** Do not use the public gallery query to decide a number is free (it lists only validated versions); retry or check the publisher portal.
- `ADO_MARKETPLACE_PAT` (scope Marketplace → Publish, **All accessible organizations**) lives only in the GitHub Actions `marketplace` environment. Never echo it, and never expose it to a `pull_request` workflow. The board PAT (`ADO_MCP_PAT_B64`) is org-scoped and cannot publish.

## Verifying in the browser (Playwright)

Use `tools/pw/` (the extension iframe is cross-origin; browser-extension automation cannot see it). Setup and the Chromium crash findings: [`docs/browser-verification.md`](docs/browser-verification.md).

- `npm run pw:auth` once, headed, to sign in to the profile at `~/.powerwiki-pw` (session cookies — never commit it).
- `npm run pw:verify` runs headless against `PW_EXTENSION=powerwiki|powerwiki-canary|powerwiki-dev` (`PW_ORG`, `PW_PROJECT`, `PW_PUBLISHER`, `PW_HUB`, `PW_CHANNEL`, `PW_HEADED=1`). Extend `tools/pw/verify.mjs` when you add a guarded feature.

## Backlog and work items

Work is tracked as Issues under the **Power Wiki** epic (#5) on the Azure Boards project named in the table above. Read and update the board with the `azure-devops` MCP server (configured in `.mcp.json`; PAT auth via an environment variable that is never stored in the repo).

Group related items with a shared **tag** (`foundation`, `rendering`, `authoring`, `parity`, `export`, `quality`, …) so the board slices into coherent, release-sized batches, and keep every item in exactly one group.

When you finish a work item, **add a resolution comment before (or as) you move it to Done**: describe how it was addressed — the approach, the key files touched, the published version, and how it was verified. Also fill in a real description on any item that lacks one.
