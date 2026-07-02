# PowerWiki

PowerWiki is an Azure DevOps extension that adds a **Power Wiki** menu experience alongside the default Azure DevOps Wiki while continuing to use the standard Azure DevOps Wiki repositories as the source of truth.

The goal is feature parity with the built-in Azure DevOps Wiki, plus modern Markdown and Mermaid rendering that can track current upstream capabilities instead of being limited to the renderer versions embedded in Azure DevOps. Users should be able to choose either the standard Wiki experience or the Power Wiki experience.

## Objectives

- Provide an alternate Power Wiki screen inside Azure DevOps without removing the default Wiki.
- Read from and write to the existing Azure DevOps Wiki Git repositories.
- Preserve expected Azure DevOps Wiki workflows, including browsing pages, page hierarchy, editing, previewing, saving, history-oriented workflows, links, attachments, and search where extension APIs allow it.
- Render Markdown with a current CommonMark/GFM-compatible pipeline.
- Render Mermaid diagrams with a current Mermaid runtime.
- Keep repository content portable by storing normal Markdown files and wiki assets rather than introducing a proprietary page format.

## Non-Goals

- Replacing Azure DevOps Wiki storage.
- Removing or hiding the default Azure DevOps Wiki experience.
- Forking wiki content into a separate service.
- Requiring teams to migrate away from their existing Azure DevOps Wiki repositories.
- Adding syntax that cannot degrade gracefully when viewed in the standard Azure DevOps Wiki.

## Expected Architecture

PowerWiki should be built as an Azure DevOps web extension that contributes an additional Power Wiki menu item and screen. The extension should authenticate through Azure DevOps extension mechanisms and interact with the existing project wiki repositories through Azure DevOps REST APIs and Git APIs.

The renderer should be isolated behind a clear boundary so Markdown and Mermaid dependencies can be upgraded without rewriting wiki navigation, editing, or persistence code.

The current scaffold follows the Microsoft Azure DevOps web extension structure with:

- `vss-extension.json` as the root extension manifest.
- `azure-devops-extension-sdk` for host initialization.
- `azure-devops-extension-api` for Azure DevOps service clients.
- Webpack and TypeScript for a production-style bundled hub page.
- React for the initial wiki screen shell.
- Markdown and Mermaid rendering isolated under `src/rendering`.

The initial manifest contributes Power Wiki under the Azure DevOps project Overview menu. It intentionally does not replace or hide the default Azure DevOps Wiki, so teams can choose either experience.

## Getting Started

Prerequisites:

- Node.js 20.9 or later.
- npm.
- An Azure DevOps organization for testing.
- Access to the `dataversepowertools` publisher before publishing or sharing the extension.

Install dependencies:

```bash
npm install
```

The manifest currently uses the `dataversepowertools` publisher and the shared Dataverse PowerTools PNG logo asset from `media/logo_new.png`.

## Build and Test

Run TypeScript validation:

```bash
npm run typecheck
```

Build the extension assets into `dist/`:

```bash
npm run build
```

Run the current test command:

```bash
npm test
```

Create a VSIX package:

```bash
npm run package:vsix
```

The package command uses `tfx-cli` and `vss-extension.json`, matching the Microsoft Azure DevOps extension packaging flow.

Publish and share the extension for testing:

```bash
npm run publish:marketplace -- --token <marketplace-pat> --share-with <azure-devops-organization>
```

The token must have Visual Studio Marketplace extension publishing rights for the `dataversepowertools` publisher. The organization value is the Azure DevOps organization name, not the full project URL.

## Initial Functionality

The current implementation provides a first read-only Power Wiki experience:

- Initializes inside Azure DevOps using the extension SDK.
- Loads the current project context.
- Lists available project wikis through the Azure DevOps Wiki client.
- Lists wiki pages and builds a navigable page tree.
- Loads selected page Markdown from the standard Azure DevOps Wiki backing store.
- Renders Markdown through the PowerWiki Markdown pipeline.
- Renders Mermaid diagrams through the bundled Mermaid runtime.
- Renders inline work item references such as `#1234` as Azure Boards badges that open the native work item form.
- Renders embedded saved query tables written as `::: query-table <query-id> :::`, with a native Azure DevOps query link when hosted by Azure DevOps Services.

Editing, saving, attachments, history, and search are planned follow-up slices.

## Azure Boards Markdown Enhancements

PowerWiki adds read-only Azure Boards rendering on top of normal wiki Markdown:

```markdown
::: query-table 9a0fb95d-55b7-4fd3-af6b-30b8921ada61 :::
```

The query table syntax runs the saved query by ID in the current project and renders up to 200 matching work items inside the page. The embedded table is PowerWiki UI because Azure DevOps does not expose the built-in query grid as a reusable extension control. The table includes a link to open the query in the native Azure DevOps query experience when a hosted organization URL can be built.

Inline work item references like `#1234` render as clickable badges in PowerWiki. Clicking a badge opens the native Azure DevOps work item form through the Work Item Tracking extension service.

In the built-in Azure DevOps Wiki, these remain readable as plain Markdown text rather than requiring a proprietary stored page format.

## Project Structure

- `public/` contains static hub HTML copied into `dist/`.
- `src/extension/` contains Azure DevOps extension host initialization and entry points.
- `src/app/` contains the initial PowerWiki screen shell.
- `src/rendering/` contains Markdown, Mermaid, and sanitization boundaries.
- `src/wiki/` contains the early wiki repository/page abstractions.
- `vss-extension.json` defines the Azure DevOps extension metadata and contributions.
- `overview.md` provides Marketplace package details.

## Details Needed

Before the extension can be published or shared with an organization, provide:

- Confirmed access to the `dataversepowertools` publisher.
- Final extension visibility choice: private or public.
- Marketplace icon and branding assets.
- Target Azure DevOps organization for test sharing.

## Contributing

Contributions should preserve the core principle of PowerWiki: Azure DevOps remains the wiki system of record, while this extension provides a more capable editing and rendering experience.

Before implementing a feature, compare it with the current Azure DevOps Wiki behavior and document any intentional differences.
