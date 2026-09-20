# Publishing both extensions (reference)

Release mechanics for the Azure DevOps extension and the VS Code extension. The headline rules stay in `AGENTS.md`.

The repository now publishes **two extensions to the same Marketplace account**,
and they are separate listings with separate version histories:

| Extension | Id | Released by |
| --- | --- | --- |
| Azure DevOps hub | `dataversepowertools.powerwiki` | a `v*` tag → `release.yml` |
| VS Code | `dataversepowertools.powerwiki-vscode` | a `vscode-v*` tag → `release-vscode.yml` |

**One version number, both extensions, released together.** They are separate
listings with separate version histories, but they render the same app from the
same commit, so `vscode/package.json` carries the *same* version as
`package.json` and `vss-extension.json`, and a release cuts both tags:
`v<version>` and `vscode-v<version>`. Two numbers meant "which VS Code build has
that fix?" was a lookup, and it was easy to release one and forget the other —
they drifted to 1.6.2 and 1.4.2 before this rule. Release both even when a
change looks like it only lands in one bundle: a shared-code change usually
reaches both, and the cost of an extra patch release is far below the cost of a
user comparing two builds that claim different versions of the same product.

**The tag prefix is load-bearing, in both directions.** Tagging the VS Code
extension `v0.1.1` would trigger the *Azure DevOps* release instead, against
manifests that do not match the tag. Less obviously, `vscode-v0.1.1` *starts
with a v*, so the hub's original `v*` filter matched it too and fired both
workflows — which is why `release.yml` now matches **`v[0-9]*`**. Do not loosen
that back to `v*`. Use `vscode-v<version>`, matching `vscode/package.json`.
`tools/release/assert-vscode-manifest.mjs` runs before anything is uploaded and
refuses a version mismatch, a wrong publisher, or — the expensive mistake — the
hub extension's id, which would replace a listing 20+ organizations update from.

**One token, both releases.** `ADO_MARKETPLACE_PAT` is a Marketplace publisher
token for `dataversepowertools` and already publishes a VS Code extension, so
the VS Code release reuses it; `VSCE_PAT` overrides it if a dedicated token is
ever wanted. It must be scoped to **All accessible organizations** — Marketplace
APIs run outside any organization context, and an org-scoped token fails with a
401 that reads like a bad credential rather than a bad scope. (The board PAT in
`ADO_MCP_PAT_B64` is org-scoped and cannot publish anything.)

**There is no private VS Code extension.** The Azure DevOps side has
`--share-with` for private dev and canary builds; the VS Code Marketplace has no
equivalent, so publishing there is public and worldwide, and a version number can
never be republished. The staging equivalents are a `.vsix` handed to a tester
(`npm run package:vscode`, then `code --install-extension`) and, once there is a
stable release to fall back to, the **pre-release channel**: a tag ending `-pre`
(`vscode-v0.2.0-pre`) publishes with `--pre-release`, so users must opt in rather
than being upgraded into a prototype. The channel is in the tag rather than
inferred from the version, because a pre-release-only extension has no obvious
way to install it — the channel is worth using from the *second* release on.

`npm run publish:vscode` is the manual fallback for a maintainer who already
holds a publisher token; CI is preferred so the token never has to exist on a
developer machine.

## Publishing

Publishing is the final step, after the change has been verified through the
layers above. **It is automated: pushing a version tag triggers
`.github/workflows/release.yml`, which packages the extension, publishes it to the
Marketplace, and attaches the `.vsix` to a GitHub Release.**

1. Bump the version in **both** `package.json` and `vss-extension.json`, and keep
   them identical — the release workflow refuses a tag that does not match both.
   Patch for fixes, documentation and store-listing changes; **minor for a user-
   visible feature**. Major stays reserved for a break in how pages are stored or
   what the extension asks permission for, which has not happened yet.
2. Run `npm test`.
3. Commit the completed change set with a clear, concise commit message.
4. Create an annotated Git tag for the patch version (for example, `v1.0.15`).
5. Push both: `git push origin main --follow-tags`. The tag starts the release.

The workflow refuses to publish if the tag does not match *both* manifest
versions, which is the usual way a release goes wrong. Watch the run — the
Marketplace rejects a re-published version number, so a failure after upload
means the next attempt needs another patch bump.

**A failed publish does not mean nothing was published.** Measured across a
Marketplace outage during 1.6.x: `tfx` reported `Request timeout: /_apis/gallery`
and, on another attempt, an HTTP 503 — and in one of those cases the upload had
*already landed*, so re-running the same tag failed with `Version number must
increase each time an extension is published. Current version: 1.6.1`.

Do not settle the question with the public gallery query
(`_apis/public/gallery/extensionquery`): **it lists only *validated* versions**,
so it cannot tell "never uploaded" from "uploaded, still validating", and
reading it as proof that a number is free is how 1.6.1 was retried by mistake.
The reliable answers are a retry (which names the current version in its error)
or the publisher portal, which shows the version as Pending, Error or live.
Validation is a separate step that can fail on its own — 1.6.1 finally showed
`Error: The HTTP request timed out after 00:00:20` there, hours after the upload
succeeded, and needed 1.6.2 to recover.

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
$pat = (Get-Content .\ado.pat -Raw).Trim()
npx tfx-cli extension publish --manifest-globs vss-extension.json --token $pat
```
