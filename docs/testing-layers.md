# Testing before release: the two layers (reference)

Sandbox and canary, plus the rules for the variant extension. The headline rule stays in `AGENTS.md`: never publish publicly in order to test.

Two layers, cheapest first. Use the cheapest one that can actually catch the
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

#### End-to-end UI tests against the sandbox

```bash
npm run test:e2e
```

Drives the real application in a real browser (`tools/e2e/run.mjs`) against the
sandbox: same `App`, same `WikiHost` boundary, in-memory wiki. It asserts on
rendered DOM — a heading on screen, the tree narrowing, Mermaid producing SVG,
an edit surviving a save and a navigation — so it fails when a user would see
something wrong rather than when an internal value changes. It runs unattended
and is part of CI, which is what `tools/pw/` cannot be.

It cannot see anything *below* the host boundary: REST contracts, permissions,
the SDK handshake, CDN paths. That is what the canary is for. When you add
a feature above the boundary, add a case here; when you add one below it, extend
`tools/pw/verify.mjs`.

The VS Code extension has the equivalent (`npm run test:vscode`), driving a real
VS Code window — see "Two hosts, one UI".

**What the VS Code suite still cannot do, and what has already been ruled out.**
An extension-host test cannot reach inside a webview's DOM, so it can only assert
on what the webview *reports* (the `ScreenReporter` in
`src/vscode/webview/main.tsx`). That is enough to observe rendering, and not
enough to *drive* input — which is why the draw.io round trip, the rich-text
editor and the Word save dialog have no coverage (tracked as AB#602).

The obvious escape — attach Playwright over the Chrome DevTools Protocol and
treat the webview as a frame — was investigated and does not work as expected:

- **`@vscode/test-electron`'s `runTests` silently drops
  `--remote-debugging-port`.** It is not forwarded to Electron, the port never
  opens, and the only symptom is `ECONNREFUSED`. Option 2 cannot piggyback on the
  existing harness; it would need its own launcher.
- Launching the `code` binary directly *does* open the port and Playwright
  connects — but no webview was reachable from it: no `<iframe>` in the workbench
  DOM, and `Target.getTargets` plus `Target.setAutoAttach` surfaced only workers.

Don't spend the afternoon rediscovering that. A test-only command channel into
the webview is the realistic route.

**Stop `dev:sandbox` with Ctrl+C, and check nothing is left behind.**
`tools/serve/serve.mjs --watch` spawns `webpack --watch` as a child and only
stops it on SIGINT, so killing the server any other way — `pkill -f serve.mjs`,
closing the terminal, a supervisor restart — leaves the watcher running. It is
invisible, it keeps rebuilding on every file change, and it writes to the same
`dist/`.

Two or more of them race, and the loser's write is not truncated: the result is a
bundle with a valid prefix and the tail of another build stapled on. `webpack
compiled successfully` is printed by each of them, the file size looks
reasonable, and the failure surfaces in the browser as a bare
`Uncaught SyntaxError: Unexpected token '='` from a line no source file
contains. One machine had accumulated **fourteen** orphaned watchers, the oldest five
days old, before anyone noticed.

Check with `ps -eo pid,etime,cmd | grep '[w]ebpack'` — an `etime` in days is
always an orphan. Kill them by pid, then `rm -rf dist` and rebuild, because the
corrupt file survives an incremental build. Beware that
`pkill -f "webpack --mode development --watch"` matches the shell running it and
kills itself first.

### 2. The canary — the real packaged artifact, in a real organization

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

A change to the manifest (a new contribution, a scope) is therefore first seen
in Azure DevOps on the canary, after it merges. That is acceptable because the
canary is private: a bad one affects only the `dataversepowertools` organization
and the next merge replaces it.

### Retired: the dev extension

There used to be a layer between these two: a private `powerwiki-dev` whose
manifest set `"baseUri": "https://localhost:3000"`, so real Azure DevOps loaded
the hub from a local HTTPS dev server (`npm run dev:extension`). It was retired
because it only works where the browser may load `localhost` inside
`dev.azure.com`: Chrome's Local Network Access checks block that by default
(`net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`), a managed browser can block
`localhost` outright, and for a merged change it tests nothing the canary does
not. Two findings from it still apply to the canary:

- **Publishing a new variant version is not the same as the organization
  running it.** Propagation is not instant — a canary took 15–20 minutes to move
  on its own after a successful publish — so wait before concluding a publish
  failed, and check the installed version first (`installedextensionsbyname`).
- **A manifest change that is not installed fails silently**: a new contribution
  simply does not appear, with no error anywhere.

### Rules for the variant extension

- They **must** use a different extension `id` from the public `powerwiki`.
  Publisher + id is the extension's identity, so publishing a private build under
  the public id would replace the public listing that every installed
  organization updates from. `tools/release/variant-manifest.mjs` derives the
  variant manifest from `vss-extension.json` so it cannot drift, and
  `tools/release/assert-private.mjs` — which the publish workflows run before
  uploading anything — refuses to publish unless `public` is exactly `false`, the
  id differs from the public one, and the publisher matches.
- `--share-with` is what actually restricts a private extension to named
  organizations. Note that neither `"public": false` nor `galleryFlags` appears
  anywhere in the packaged `.vsix` — visibility is applied at publish time — so
  **confirm in the publisher portal that a newly created variant really is private
  the first time you publish it.** It cannot be verified from the package.
- Every contribution is relabelled ("Power Wiki (Canary)"), because
  an organization with more than one build installed otherwise shows several
  identical "Power Wiki" menu entries with no way to tell them apart.
- The variant requests the same `scopes`, so installing it needs the same one-time
  admin consent.
