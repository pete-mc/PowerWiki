# Agents Guide

This repository is for PowerWiki, an Azure DevOps extension that adds a Power Wiki menu experience alongside the default Azure DevOps Wiki while continuing to use the standard Azure DevOps Wiki repositories as the backing store.

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

Renderer dependencies should be easy to upgrade independently from the Azure DevOps integration. Any renderer-specific behavior should be covered by fixtures so future Markdown or Mermaid upgrades are deliberate.

## Documentation Expectations

Update `README.md` when the project gains concrete setup, build, packaging, or publishing steps.

When implementing features, document any difference from the built-in Azure DevOps Wiki behavior, especially if the difference affects stored Markdown, links, attachments, permissions, or page history.

## Publishing

After every set of changes, always publish to the marketplace:

1. Increment only the patch version (the third number) in both `package.json` and `vss-extension.json`. Never change the major or minor version.
2. Run `npm run build`.
3. Run: `$pat = (Get-Content C:\Users\peter\sources\repos\PowerWiki\ado.pat -Raw).Trim(); npx tfx-cli extension publish --manifest-globs vss-extension.json --token $pat`
4. Commit the completed change set with a clear, concise commit message.
