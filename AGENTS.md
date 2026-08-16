# Agents Guide

This repository is for PowerWiki, an Azure DevOps extension that adds a Power Wiki menu experience alongside the default Azure DevOps Wiki while continuing to use the standard Azure DevOps Wiki repositories as the backing store.

## Agent instruction files

This file is the authoritative guide for **every** AI agent and human working in
this repository, and it is meant to stay tool-neutral. `AGENTS.md` is the
cross-tool convention, so keep the guidance here and add per-tool files only as
thin pointers to it — `CLAUDE.md` is exactly that and holds no guidance of its
own. Duplicated instructions drift apart, and then whichever copy an agent
happens to load wins.

Machine-specific notes (provisioned tool versions, local credential paths, how a
browser or display is launched on one box) do not belong here. They go in an
untracked `CLAUDE.local.md` / `AGENTS.local.md`, which `.gitignore` covers. The
test: if a note would also be true on another contributor's machine, it belongs
in this file.

## Where things live

| Concern | Location |
| --- | --- |
| Source code (authoritative) | <https://github.com/pete-mc/PowerWiki> — public, MIT, `origin` |
| CI | GitHub Actions: `ci.yml` (test + build), `codeql.yml`, `dependency-review.yml` |
| Releases | `release.yml` — a `v*` tag publishes to the Marketplace and creates a GitHub Release |
| Backlog / planning | Azure Boards, **PowerWiki** project: `dev.azure.com/dataversepowertools/PowerWiki` |
| Test & showcase wiki | The **PowerWiki** project's wiki (`PowerWiki.wiki`) |
| Marketplace listing | Publisher `dataversepowertools`, extension `powerwiki` |

Code is public; the backlog stays on Azure Boards. Link commits and pull requests
to work items with `AB#<id>` mentions (an Azure Boards ↔ GitHub connection is
configured on the PowerWiki project) rather than duplicating the backlog into
GitHub Issues — GitHub Issues is public intake for bug reports and feature
requests. Contributor-facing build/test instructions live in `CONTRIBUTING.md`.

The old Azure DevOps code repository (in the `dataversepowertools` project) is
**disabled** — do not push there. The old project's wiki still exists as a
migration backup but is no longer the one under test.

## Product Direction

PowerWiki should feel like the normal Azure DevOps Wiki to users, but with an upgraded Markdown and Mermaid experience. It should not remove, hide, or disable the standard Azure DevOps Wiki experience.

Primary goals:

- Preserve feature parity with the built-in Azure DevOps Wiki wherever extension APIs make that possible.
- Use the existing Azure DevOps Wiki Git repositories as the source of truth.
- Store content as normal Markdown and wiki assets.
- Support current Markdown behavior through a maintainable CommonMark/GFM-compatible rendering pipeline.
- Support current Mermaid diagrams through an upgradeable Mermaid integration.
- Avoid custom page formats or storage that would lock teams into PowerWiki.

## Expected User Workflows

The extension should support the standard wiki workflows before adding new behavior:

- Browse wiki pages and hierarchy.
- Render Markdown pages.
- Render Mermaid diagrams.
- Create, edit, rename, move, and delete pages.
- Preview edits before saving.
- Save changes back to the Azure DevOps Wiki repository.
- Preserve links, attachments, images, and relative paths.
- Expose history, revision, compare, and search workflows where Azure DevOps extension APIs support them.

## Engineering Constraints

- Treat Azure DevOps Wiki as the system of record.
- Prefer official Azure DevOps extension SDKs and REST APIs.
- Keep renderer code separated from Azure DevOps data access and UI state.
- Keep Markdown source portable and readable in the built-in Azure DevOps Wiki.
- Make unsupported parity gaps explicit in documentation and tests.
- Do not introduce a backend service unless the requirement cannot reasonably be met inside an Azure DevOps extension.

## Theming

PowerWiki should follow the active Azure DevOps theme rather than defining an independent visual theme. Keep app colors behind the `--pw-*` design tokens in `src/app/styles.css`, and map those tokens to Azure DevOps CSS variables injected by the host wherever possible. Prefer transparent surfaces and neutral translucent borders/hovers so light, dark, and custom Azure DevOps themes remain legible.

Theme mode detection lives in `src/app/themeMode.ts`. It infers light or dark mode from the luminance of host CSS variables such as `--background-color` and `--text-primary-color`, not from theme names, and updates on `themeApplied` and `themeChanged` events. Use that shared hook for components that need a binary light/dark decision. Monaco should switch between `vs` and `vs-dark`, and Mermaid should be re-rendered with the matching Mermaid theme when the host theme changes.

When changing theming, verify regular UI chrome, Markdown preview content, editor chrome, and Mermaid diagrams in both light and dark Azure DevOps themes. If a feature needs a hard-coded color, keep it scoped to semantic states such as destructive actions or warnings.

## File and Folder Structure

Keep the repository organized around clear responsibilities as the extension grows. Avoid placing unrelated concerns in the same directory just because they are used by the same screen.

Expected structure should separate:

- Azure DevOps extension manifest and host wiring.
- Azure DevOps API clients.
- Wiki repository and page models.
- Markdown and Mermaid rendering.
- Editor, preview, navigation, and page tree UI.
- Shared UI components.
- Tests, fixtures, and test utilities.
- Build, packaging, and release scripts.

Do not create large single files that mix UI, API access, rendering, state management, and business rules. Split files when a module becomes hard to scan, when it owns more than one responsibility, or when tests would need to reach through unrelated behavior to exercise it.

Prefer small, named modules with explicit exports over broad utility files. A file should have a clear reason to exist and a name that describes its primary responsibility. Avoid catch-all files such as `helpers`, `utils`, or `common` unless the contents are genuinely small, stable, and cohesive.

When adding a new feature, place code near the feature it serves, but keep shared behavior in shared modules only after there is a real second use case. Do not prematurely centralize code in a way that makes feature work harder to understand.

## Implementation Notes

When the scaffold is added, keep these boundaries clear:

- Extension host and manifest configuration.
- Azure DevOps API client code.
- Wiki repository/page model.
- Markdown rendering.
- Mermaid rendering.
- Editor and preview UI.
- Navigation and page tree UI.
- Tests and fixtures.

Renderer dependencies should be easy to upgrade independently from the Azure DevOps integration. Any renderer-specific behavior should be covered by fixtures so future Markdown or Mermaid upgrades are deliberate. Those fixtures live in `src/rendering/*.test.ts` (Vitest); run `npm test` (TypeScript check + unit tests) before publishing, and `npm run pw:verify` for end-to-end checks.

The wiki **attachments API is create-only**. `PUT .../attachments?name=` returns
201 the first time and then fails with HTTP 500 `"The path '/.attachments/…'
specified in the add operation already exists. Please specify a new path."` for
that name — `If-Match` makes no difference, and there is no update or delete
endpoint. This was probed exhaustively: every other method (DELETE, POST, PATCH,
HEAD, GET) returns 405 with `allow: PUT`, on every api-version from 4.1 to
7.2-preview, and deleting a page does not cascade to its attachments. Don't
re-litigate it — a stored attachment cannot be replaced or removed without
`vso.code_write`. The pages API *can* update in place but always writes `<path>.md`, so
it cannot store a binary. Anything needing mutable binary content therefore has
to write a new file and repoint its references (see `src/drawio/`), unless the
extension takes `vso.code_write` to push to the wiki repository directly — which
would force every organization to re-approve the extension, so don't.

**Anything read back out of the rendered DOM has not been sanitized.**
`sanitizeRenderedHtml` runs once, before the HTML is inserted; the preview's
enrichers then read attributes back out and write them to real sinks. DOMPurify
leaves `data-*` attributes untouched (it validates URIs only on known
attributes such as `src`/`href`), so a page author can plant any value in one
with raw HTML. An enricher that copies such a value into a URL sink therefore
bypasses the sanitizer — validate it first, as `enrichImages` does via
`toSafeImageUrl` (`src/rendering/safeImageUrl.ts`). This was CodeQL's
`js/xss-through-dom` finding; keep new enrichers to the same rule.

Note the shape of that guard: it **returns the parsed value**, and the caller
assigns *that*. A boolean `if (isSafe(x)) use(x)` does not fix the problem — the
original untrusted string still reaches the sink, the check and the sink can
drift apart later, and CodeQL keeps reporting it (correctly). Validate by
replacing the value, not by asserting about it.

**markdown-it 15 removed its deep export paths.** `markdown-it/lib/token.mjs`
and `markdown-it/lib/rules_inline/state_inline.mjs` no longer resolve — the
package only exports `.` and `./browser`. Import the types by name from the
package root instead (`import type { MarkdownIt, Token, StateInline } from
"markdown-it"`). The root's *default* export is the callable constructor, while
`MarkdownIt` itself is only a type, so a module needing both must import them
separately (see `createMarkdownRenderer.ts`). `Token` has no runtime export at
all: build tokens with the constructor the parser exposes as `state.Token` (see
`adoWorkItemsPlugin.ts`). Attribute values are now typed `string | number`, so
`attrGet`/`attrs[i][1]` need normalising where a string is required.

**The webpack build transpiles only; `tsc` is what checks types.** TypeScript 7
is the native compiler port and no longer exposes the JS compiler-host API that
`ts-loader` drove, so the bundle is produced by `esbuild-loader` instead. That is
safe because `tsconfig.json` sets `isolatedModules`, which makes TypeScript
guarantee every file can be transpiled on its own — but it does mean **a type
error will not fail `npm run build`**. Always run `npm test` (which runs
`tsc --noEmit` first); CI runs both. Keep the loader's `target` and `jsx` options
in step with `tsconfig.json` if you change either.

Node 24.15+ is required to build and test (jsdom 30 and its undici 8 dropped
Node 20, which is EOL). This affects contributors and CI only — the extension
itself runs in the browser.

Mermaid is loaded as a lazily-imported async chunk (`import("mermaid")` in `renderMermaidDiagrams`) to keep the initial hub bundle small, and webpack uses `output.publicPath: "auto"` so those chunks load from the extension's own CDN `dist/` path. Do not reintroduce a single-chunk limit (`LimitChunkCountPlugin`); if you change the webpack config, confirm Mermaid still renders in the iframe with `npm run pw:verify`.

## Build and test gating

`npm run build` **will not fail on a type error.** The bundle is transpiled by
esbuild-loader, which strips types without checking them; `tsc` runs separately.
Always gate on `npm test` (which runs `tsc --noEmit` and then Vitest), never on a
successful build.

The two webpack warnings about entrypoint/asset size (~665 KiB) are known and
expected. They are not a failure.

## Documentation Expectations

Update `README.md` when the project gains concrete setup, build, packaging, or publishing steps.

When implementing features, document any difference from the built-in Azure DevOps Wiki behavior, especially if the difference affects stored Markdown, links, attachments, permissions, or page history.

## Publishing

After every set of changes, always publish to the marketplace. **Publishing is
automated: pushing a version tag triggers `.github/workflows/release.yml`, which
packages the extension, publishes it to the Marketplace, and attaches the `.vsix`
to a GitHub Release.**

1. Increment only the patch version (the third number) in both `package.json` and `vss-extension.json`. Never change the major or minor version.
2. Run `npm test`.
3. Commit the completed change set with a clear, concise commit message.
4. Create an annotated Git tag for the patch version (for example, `v1.0.15`).
5. Push both: `git push origin main --follow-tags`. The tag starts the release.

The workflow refuses to publish if the tag does not match *both* manifest
versions, which is the usual way a release goes wrong. Watch the run — the
Marketplace rejects a re-published version number, so a failure after upload
means the next attempt needs another patch bump.

The publisher token lives in the `ADO_MARKETPLACE_PAT` GitHub Actions secret and
is consumed only by the release workflow, which is pinned to the `marketplace`
environment so approval rules can be added to it. Never echo the secret in a
workflow, and never add it to a workflow that runs on `pull_request` — that
would expose it to forks.

That PAT must be created with exactly:

- **Scopes: Marketplace → Publish** (`vso.gallery_publish`). Nothing else is
  needed; "Manage" is broader than publishing requires.
- **Organization: All accessible organizations.** This is mandatory, not a
  preference — the Marketplace publishing APIs run outside any organization
  context, so a PAT scoped to a single organization fails to authenticate even
  though it is perfectly valid. This is the usual cause of a 401 on publish.

The account owning the PAT must be a member of the `dataversepowertools`
publisher. PATs expire (one year maximum), and an expired one fails the release
job — Microsoft now recommends Microsoft Entra service-principal tokens over
PATs for automation, which also removes the renewal treadmill.

Manual publish remains available as a fallback (unchanged, requires local
`ado.pat`):

```powershell
npm run build
$pat = (Get-Content C:\Users\peter\sources\repos\PowerWiki\ado.pat -Raw).Trim()
npx tfx-cli extension publish --manifest-globs vss-extension.json --token $pat
```

## Verifying in the browser (Playwright)

PowerWiki runs inside a cross-origin iframe (`gallerycdn.vsassets.io`) hosted in
`dev.azure.com`. Browser-extension automation can only see the top frame, so it
cannot read the extension iframe's DOM, console, or network, and its screenshots
don't reach the repo filesystem. Use the Playwright harness in `tools/pw/`
instead — Playwright treats the cross-origin iframe as a first-class frame, so it
can assert on the real rendered DOM, capture iframe console/network, and save
screenshots locally. Prefer it for verifying rendering and editing behavior.

Because the extension only runs from the published Marketplace build, verify a
change by publishing it first (see Publishing). The org auto-updates to the new
version within a few minutes; a change that alters `scopes` instead pauses at
"Pending review" until an org admin approves it in Organization settings →
Extensions.

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

Extend `tools/pw/verify.mjs` with a new assertion whenever you add a feature
worth guarding, so the harness doubles as a regression smoke test.

## Backlog and work items

Work is tracked as Issues under the **Power Wiki** epic (#5) in the **PowerWiki**
Azure DevOps project (`dev.azure.com/dataversepowertools/PowerWiki`). Read and
update the board with the `azure-devops` MCP server (configured in `.mcp.json`;
PAT auth via the `ADO_MCP_PAT_B64` environment variable — the token is never
stored in the repo).

The source of truth for code is GitHub: <https://github.com/pete-mc/PowerWiki>.
Azure Boards remains the planning board — link commits and pull requests to work
items with `AB#<id>` mentions rather than duplicating the backlog into GitHub
Issues. GitHub Issues is public intake for bug reports and feature requests.

Group related items with a shared **tag** (`foundation`, `rendering`,
`authoring`, `parity`, `export`, `quality`, …) so the board slices into coherent,
release-sized batches, and keep every item in exactly one group.

When you finish a work item, **add a resolution comment before (or as) you move
it to Done**: describe how it was addressed — the approach, the key files
touched, the published version, and how it was verified. This keeps the board
self-documenting. Also fill in a real description on any item that lacks one.
