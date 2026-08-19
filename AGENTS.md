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

## Two hosts, one UI

PowerWiki runs in two places: the Azure DevOps hub, and a VS Code extension that
works off a **cloned wiki repository** with no service connection at all
(`vscode/`, sources in `src/vscode/`). Both render the same React app.

That is only affordable because of one rule, and it is the rule to defend:

> **Nothing under `src/app/`, `src/rendering/`, or `src/export/` may import a
> host SDK.** Everything host-specific goes through `WikiHost`
> (`src/host/WikiHost.ts`), and each host implements it.

There are three implementations — `src/host/azureDevOpsWikiHost.ts`,
`src/vscode/webview/VsCodeWikiHost.ts`, and `src/sandbox/sandboxWikiHost.ts` —
and adding a feature means adding it once, above the interface. If a feature
genuinely needs something only one host can do, it gets a member on `WikiHost`
and the other hosts answer for themselves; it does not get an
`if (runningInVsCode)`.

**Capabilities, not sniffing.** `WikiHostCapabilities` says what a host *can*
do, and the UI omits what is unavailable rather than rendering an action that
fails. Off a clone that means no comments (they are service state, not files),
no follow, no page tree (the VS Code Explorer is the tree), no wiki picker (the
editor tab already chose), and work items and `@mentions` left inert. Do not
reintroduce these as disabled buttons — absent is the honest rendering.

**Things that are only true in a webview.** They are host-shaped traps, and each
one already cost a debugging round:

- `window.confirm` / `prompt` / `alert` do **not** work. A VS Code webview iframe
  is sandboxed without `allow-modals`, so `confirm()` returns false and
  `prompt()` returns null — silently. Use `host.dialogs`, which is async for
  exactly this reason.
- **Nothing relative resolves.** A webview document has an opaque origin, so
  asset paths must be `asWebviewUri` values passed in through the init message
  (see the logo and Monaco's base URL).
- **`postMessage` to a webview is not queued.** Anything sent before the bundle
  attaches its `message` listener is dropped, so the webview sends `ready` first
  and the extension replies with `init`. Without that handshake it fails only on
  fast machines.
- **A webview cannot start a download**, so a generated file goes through
  `host.saveExportedFile`, which in VS Code sends the bytes to the extension host
  for a save dialog. It also cannot print, which is why `capabilities.printToPdf`
  exists and the PDF option is hidden there.
- **`postMessage` serialises as JSON**, so an `ArrayBuffer` would arrive as `{}`.
  `BINARY_WIKI_METHODS` in `src/vscode/protocol.ts` names the methods that cross
  as base64; keep it in step if a method starts returning bytes.

**The local wiki client.** `src/vscode/GitWikiRepositoryClient.ts` implements the
same `WikiRepositoryClient` the REST client does, over the filesystem. Two things
the service normally handles are ours there, and are where bugs live: the
page-path-to-file-name encoding (`wikiPathEncoding.ts` — spaces become hyphens,
a literal hyphen becomes `%2D`, and decode order matters) and `.order`
(`orderFile.ts` — pages missing from it still exist, and a folder that never had
one does not get one). Two things are *better* off a clone: attachments are
mutable, so the create-only limitation documented above does not apply, and
history uses `git log --follow`, so a renamed page keeps its history without the
reconstruction in `src/wiki/renameHistory.ts`.

**Testing it.** `npm run test:vscode` builds the extension and runs a Mocha suite
inside a real VS Code window against a generated three-layout workspace
(`src/vscode/test/`). An extension-host test cannot read a webview's DOM, so the
webview reports what it rendered (the `ScreenReporter` in
`src/vscode/webview/main.tsx`) and the tests wait for a report that satisfies a
predicate. Assert on that reported *rendering*, not on internal state — the
point is to catch a UI that silently stops drawing. The suite lives under
`src/vscode/test/`, which `vitest.config.ts` excludes, because it imports the
`vscode` module and only runs inside VS Code.

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

**Wiki search is a different service on a different host, and it reports
trouble as success.** Search lives on `almsearch.dev.azure.com`, not
`dev.azure.com`, and `azure-devops-extension-api` ships no Search client — hence
the hand-rolled request in `src/wiki/wikiSearch.ts`, with the token-authenticated
POST kept separately in `src/wiki/wikiSearchTransport.ts` so the request building
and response mapping stay testable without a network. The `vso.wiki` scope
already covers searching, so this needs no new scope. The trap: an organization
whose index is not ready answers a *valid* query with HTTP 200, `count: 0` and an
`infoCode` saying why. Rendering that as "no results found" tells the user their
content is missing when the index is merely still building, so every status
`interpretInfoCode` can return has to reach the UI. Search snippets arrive
wrapped in the service's own `<highlighthit>` markup around wiki content, so they
are parsed into `{ text, isMatch }` segments and rendered as React text nodes —
they must never reach `innerHTML`.

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

## Testing before release

**Do not publish to the public Marketplace in order to test a change.** The
Marketplace has no staged rollout for extension updates: every organization that
has installed PowerWiki auto-updates within minutes, there are 20+ of them, and a
version number can never be republished. Publishing publicly is a production
deployment, and it is the *last* step, not the first.

Three layers, cheapest first. Use the cheapest one that can actually catch the
class of bug you are working on.

### 1. The local sandbox — no Azure DevOps at all

```bash
npm run dev:sandbox        # http://localhost:3000/dist/sandbox.html
```

Runs the whole UI against an in-memory wiki (`src/sandbox/`), with no
organization, no extension install, and no sign-in. Rebuilds on change. Append
`?theme=dark` to check the dark theme, `?latency=800` to make loading states
obvious, or `?searchInfoCode=2` to make the fake search service answer the way an
organization whose index is still building does (see `src/sandbox/fakeWikiSearch.ts`).

This is the right loop for rendering, the editors, the page tree, export, and
theming — most of the codebase. It cannot catch REST-contract drift, permission
errors, host-service behaviour, or CDN problems, because it fakes the wiki client
and skips the extension SDK entirely. Follow, work-item enrichment, and
`@mention` resolution go through host services that are not faked, so they
degrade; the seed content includes examples so you can see how.

### 2. The dev extension — real Azure DevOps, working-tree code, no publishing

A private extension (`powerwiki-dev`) whose manifest sets
`"baseUri": "https://localhost:3000"`. Azure DevOps then resolves the hub's
assets against your machine instead of the CDN, so the code running inside a real
hub is your working tree.

Publish it **once** by running the *Publish dev extension* workflow
(Actions → Publish dev extension → Run workflow), which takes the `baseUri` and the
organizations to share with as inputs. Publishing from CI means the Marketplace
token never has to exist on a developer machine — nothing about publishing
PowerWiki requires one locally. Then iterate freely:

```bash
npm run dev:extension      # serves dist/ over HTTPS, rebuilding on change
```

Re-run the workflow only if the manifest, scopes, or `baseUri` change.
`npm run publish:dev` does the same thing locally and stays available for anyone
who already holds a publisher token.

One published build serves everyone: `localhost` resolves to whichever machine
the *browser* is on, so the default `baseUri` is not tied to whoever ran the
workflow. Start the dev server on port 3000 and the hub loads *your* working
tree. Only a non-localhost `baseUri` — a tunnel origin, say — would pin the
build to one machine and need republishing to move.

The HTTPS server generates a self-signed localhost certificate on first run
(`tools/serve/`); accept it once in your browser. `npm run pw:verify` sets
`ignoreHTTPSErrors`, so the unattended harness never sees the interstitial.

#### The browser must be allowed to reach the local network

Chrome blocks a **public** origin from loading a subresource on the **local
network**, and `dev.azure.com` embedding `https://localhost:3000` is exactly that
shape. Left alone, the hub iframe fails with
`net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` and the blocked frame reads
"The connection is blocked because it was initiated by a public page to connect
to devices or servers on your local network."

`npm run pw:verify` handles this by launching with
`--disable-features=LocalNetworkAccessChecks`. **In an ordinary browser you must
allow local network access for the site yourself** — this layer does not work
without it.

The symptom is unhelpful: the hub shows only "PowerWiki (Dev) is taking longer
than expected to load". Nothing about the dev server looks wrong when this
happens, because nothing is — it serves the HTML and chunks with permissive CORS
and no frame-blocking headers, and the same browser loads that URL fine in a
top-level tab. Diagnose it from the network panel, not the hub.

**A stopped dev server looks identical.** The dev build has no
`fallbackBaseUri`, so nothing sits behind `https://localhost:3000`. The canary
carries both a CDN `baseUri` *and* a `fallbackBaseUri` pointing at a
`privateasset/<token>` URL — and loads from the fallback, because a private build
is not served from the public CDN. Check `npm run dev:extension` is actually
running before diagnosing anything else.

This catches everything the sandbox cannot except problems in the packaged
artifact itself, since `baseUri` bypasses the packaged files.

### 3. The canary — the real packaged artifact, in a real organization

`.github/workflows/canary.yml` publishes a private `powerwiki-canary` on every
push to `main`, shared only with the `dataversepowertools` organization, versioned
`<base>.<run_number>`. It needs no new credential — it reuses the same
`ADO_MARKETPLACE_PAT` and `marketplace` environment as the release. Verify it, then
promote:

```bash
PW_EXTENSION=powerwiki-canary npm run pw:verify
```

The public release then promotes a build that has already run in real Azure
DevOps, rather than being the first time anyone has seen it.

### Rules for the variant extensions

- They **must** use a different extension `id` from the public `powerwiki`.
  Publisher + id is the extension's identity, so publishing a private build under
  the public id would replace the public listing that every installed
  organization updates from. `tools/release/variant-manifest.mjs` derives the
  variant manifests from `vss-extension.json` so they cannot drift, and
  `tools/release/assert-private.mjs` — which both publish workflows run before
  uploading anything — refuses to publish unless `public` is exactly `false`, the
  id differs from the public one, and the publisher matches.
- `--share-with` is what actually restricts a private extension to named
  organizations. Note that neither `"public": false` nor `galleryFlags` appears
  anywhere in the packaged `.vsix` — visibility is applied at publish time — so
  **confirm in the publisher portal that a newly created variant really is private
  the first time you publish it.** It cannot be verified from the package.
- All three contributions are relabelled ("Power Wiki (Dev)", "(Canary)"), because
  an organization with more than one build installed otherwise shows several
  identical "Power Wiki" menu entries with no way to tell them apart.
- A variant requests the same `scopes`, so installing it needs the same one-time
  admin consent.

## Publishing the VS Code extension

The repository now publishes **two extensions to the same Marketplace account**,
and they are separate listings with separate version histories:

| Extension | Id | Released by |
| --- | --- | --- |
| Azure DevOps hub | `dataversepowertools.powerwiki` | a `v*` tag → `release.yml` |
| VS Code | `dataversepowertools.powerwiki-vscode` | a `vscode-v*` tag → `release-vscode.yml` |

**The tag prefix is load-bearing.** Tagging the VS Code extension `v0.1.1` would
trigger the *Azure DevOps* release instead, against manifests that do not match
the tag. Use `vscode-v<version>`, matching `vscode/package.json`.
`tools/release/assert-vscode-manifest.mjs` runs before anything is uploaded and
refuses a version mismatch, a wrong publisher, or — the expensive mistake — the
hub extension's id, which would replace a listing 20+ organizations update from.

**The tokens are not interchangeable.** `ADO_MARKETPLACE_PAT` has Marketplace →
*Publish* scope, which `tfx-cli` accepts. `vsce` requires Marketplace →
**Manage**, so the VS Code release uses a separate `VSCE_PAT` secret. Both need
**All accessible organizations** — Marketplace APIs run outside any organization
context, and an org-scoped token fails with a 401 that looks like a bad
credential rather than a bad scope.

**There is no private VS Code extension.** The Azure DevOps side has
`--share-with` for private dev and canary builds; the VS Code Marketplace has no
equivalent, so publishing there is public and worldwide, and a version number can
never be republished. The staging equivalents are a `.vsix` handed to a tester
(`npm run package:vscode`, then `code --install-extension`) and, once published,
the **pre-release channel** — `release-vscode.yml` publishes `0.x` versions with
`--pre-release`, so Marketplace users must opt in rather than being upgraded into
a prototype.

`npm run publish:vscode` is the manual fallback for a maintainer who already
holds a publisher token; CI is preferred so the token never has to exist on a
developer machine.

## Publishing

Publishing is the final step, after the change has been verified through the
layers above. **It is automated: pushing a version tag triggers
`.github/workflows/release.yml`, which packages the extension, publishes it to the
Marketplace, and attaches the `.vsix` to a GitHub Release.**

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

The harness runs against whichever build you point it at, so it does **not**
require a public release — see "Testing before release":

```bash
npm run pw:verify                                  # public powerwiki
PW_EXTENSION=powerwiki-canary npm run pw:verify    # the pre-release canary
PW_EXTENSION=powerwiki-dev    npm run pw:verify    # working tree, via baseUri
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
