# Azure DevOps API and build constraints (reference)

Measured constraints and traps that have already cost real time. Summarised in `AGENTS.md`; the detail lives here unchanged. Do not re-litigate the ones marked ruled out.

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

**The work item form tab cannot have an icon, and cannot be icon-only.**
Microsoft documents it plainly on the extensibility-points reference: `icon` and
`iconName` "work for hubs, menus, and toolbars only. They don't work for tab
contributions." The `ms.vss-work-web.work-item-form-page` schema exposes only
`name` and `uri`, and `name` is the sole source of the tab's label — the on-prem
layout XML confirms it, where `<ControlContribution>` takes a `Label` and
`<PageContribution>` takes none. Azure DevOps *does* render icon-only pivots on
that form (History, Links, Attachments), but does not expose the capability to
extensions.

`media/screenshots/powerwiki-workitem.png`, shot against the published build, is
the proof: the same `media/logo_new.png` renders beside the hub entries in the
left rail and is absent from all three "Power Wiki" form tabs. The `icon` on that
contribution was therefore dead weight and has been removed. Don't add it back,
and don't try to shorten the tab to a glyph by blanking `name` — an unlabelled
tab is not a documented state, and the one approximation (an emoji in `name`) is
unthemed and unreadable to a screen reader.

**The work item form must never write the browser's URL.** This is the cause of
the "the modal closes by itself" reports, and it is measured rather than
deduced. The host navigation service (`ms.vss-features.host-navigation-service`)
writes the **top page's** URL, not the extension iframe's. Azure DevOps keeps the
open work item dialog in that same URL: an item opened from a backlog or board is
`..._backlogs/backlog/<team>/Issues?workitem=601`. So a hash written from the tab
is a route change on the page the dialog belongs to, and the dialog is dismissed.

Driving the canary with `tools/pw/`, opening 601 from the backlog and clicking the
tab took the URL from `?workitem=601` to
`?workitem=601#/PowerWiki%20Showcase/Mermaid%20Gallery`, and the `[role="dialog"]`
count went 1 → 0 in the same step. Any action that changes the active page did it:
selecting a linked page, and linking a new one (which then opens it). Full screen
was unaffected, because there is no dialog for the route change to dismiss — which
is exactly why it looked intermittent and unrelated to what the user had clicked.

`getNavigation()` therefore returns `undefined` on the `workItem` surface, and the
route lives on the iframe's own URL instead. The app already supports a host with
no navigation service — the sandbox has none — so this degrades to not restoring a
page across a reload, on a surface where a URL into one tab of one work item was
never a place anyone links to. `buildPageUrl` is untouched, so the shareable link
to the page itself still works. `azureDevOpsWikiHostNavigation.test.ts` pins it,
including that the hub still asks, so the check cannot pass vacuously.

**The work item form iframe is not sandboxed at all, so `window.confirm` works
there.** This was an open worry — a VS Code webview is sandboxed without
`allow-modals`, where `confirm()` returns false *silently*, and nobody had
checked whether the form page behaves the same way. Measured against the
published 1.4.2 build: the extension iframe on the work item form carries **no
`sandbox` attribute**, and clicking the rail's unlink button raises a real
`confirm` (Playwright's `dialog` event fires with the button's own message). So
`browserDialogs` is sound on this surface and no
`IHostPageLayoutService.openMessageDialog` fallback is needed. Do not re-open
this without a new measurement; the answer is a property of the host, not of our
code.

**What is still unverified about that surface:**

- Whether `openWorkItem()` called from *inside* a dialog stacks, replaces, or
  closes it. Undocumented. The one call that provably navigated the open form was
  the rail's old "Manage links…" button, on the item already on screen, and it is
  gone.

Ruled out, so do not re-investigate: PowerWiki binds no hover, pointer, focus or
blur handler anywhere, and DOM events do not cross an iframe boundary, so nothing
here can propagate an `Escape` or a click to the host dialog's dismiss handler.
Chrome's removal of `alert`/`confirm`/`prompt` in cross-origin iframes is **not** a
factor — it shipped in Chrome 92, broke the web, was rolled back, and is marked
"No longer pursuing".

One thing that *is* documented: a `work-item-form-page` contribution is unloaded
the moment the dialog closes, which is why `onSaved` has to be observed from a
`ms.vss-work-web.work-item-notifications` contribution instead.

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
