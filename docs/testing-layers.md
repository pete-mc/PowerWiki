# Testing before release: the three layers (reference)

Sandbox, dev extension and canary, plus the rules for the variant extensions. The headline rule stays in `AGENTS.md`: never publish publicly in order to test.

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
the SDK handshake, CDN paths. That is what layers 2 and 3 are for. When you add
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

**And when you do, the publish is not enough — the organization keeps running the
copy it already installed.** `powerwiki-dev` sat at 1.3.8.2 across two successful
publishes. The extension-management API will not force it either:

- `PATCH .../installedextensionsbyname/<publisher>/<extension>` → **405**
- `POST .../installedextensionsbyname/<publisher>/<extension>/<version>` → **409
  `ExtensionAlreadyInstalledException`**

What works is to remove it and install it again:

```
DELETE .../_apis/extensionmanagement/installedextensionsbyname/dataversepowertools/powerwiki-dev
POST   .../_apis/extensionmanagement/installedextensionsbyname/dataversepowertools/powerwiki-dev
```

after which it picks up the newest published version. Propagation is not instant
in any case — a canary took 15–20 minutes to move on its own after a successful
publish — so wait before concluding a publish failed.

**The failure mode is silent, which is why this is worth knowing.** `baseUri`
means the hub loads your working tree happily, so the code is current; only the
*contributions* come from the installed manifest. A newly added contribution
therefore simply does not appear, with nothing broken-looking anywhere: no error,
no stale-version banner, just a menu entry or a tab that is missing. If something
you added to the manifest is not showing up, check the installed version before
you debug the code.
`npm run publish:dev` does the same thing locally and stays available for anyone
who already holds a publisher token.

One published build serves everyone: `localhost` resolves to whichever machine
the *browser* is on, so the default `baseUri` is not tied to whoever ran the
workflow. Start the dev server on port 3000 and the hub loads *your* working
tree. Only a non-localhost `baseUri` — a tunnel origin, say — would pin the
build to one machine and need republishing to move.

**Stop the dev server with Ctrl+C, and check nothing is left behind.**
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
