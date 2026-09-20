# Two hosts, one UI (reference)

Reference detail for the `WikiHost` boundary rule summarised in `AGENTS.md`. Moved out of `AGENTS.md` unchanged.

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
mutable, so the create-only limitation documented in `azure-devops-constraints.md` does not apply, and
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
