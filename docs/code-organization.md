# Code organization (reference)

## File and folder structure

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


## Implementation notes

Keep these boundaries clear: extension host and manifest, Azure DevOps API client,
wiki repository/page model, Markdown rendering, Mermaid rendering, editor and
preview UI, navigation and page tree UI, tests and fixtures. Renderer
dependencies must be upgradeable independently of the Azure DevOps integration,
and any renderer-specific behavior is covered by fixtures in
`src/rendering/*.test.ts` (Vitest) so Markdown or Mermaid upgrades are deliberate.
Run `npm test` (TypeScript check + unit tests) before publishing, and
`npm run pw:verify` for end-to-end checks.

