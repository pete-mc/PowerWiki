# PowerWiki

PowerWiki is an Azure DevOps extension that adds a **Power Wiki** menu experience alongside the default Azure DevOps Wiki while continuing to use the standard Azure DevOps Wiki repositories as the source of truth.

The goal is feature parity with the built-in Azure DevOps Wiki, plus modern Markdown and Mermaid rendering that can track current upstream capabilities instead of being limited to the renderer versions embedded in Azure DevOps. Users should be able to choose either the standard Wiki experience or the Power Wiki experience.

## Objectives

- Provide an alternate Power Wiki screen inside Azure DevOps without removing the default Wiki.
- Read from and write to the existing Azure DevOps Wiki Git repositories.
- Preserve expected Azure DevOps Wiki workflows, including browsing pages, page hierarchy, editing, previewing, saving, comments, history-oriented workflows, links, attachments, and search where extension APIs allow it.
- Render Markdown with a current CommonMark/GFM-compatible pipeline.
- Render Mermaid diagrams with a current Mermaid runtime.
- Follow Azure DevOps light, dark, and custom themes without requiring a separate PowerWiki theme setting.
- Keep repository content portable by storing normal Markdown files and wiki assets rather than introducing a proprietary page format.

## Non-Goals

- Replacing Azure DevOps Wiki storage.
- Removing or hiding the default Azure DevOps Wiki experience.
- Forking wiki content into a separate service.
- Requiring teams to migrate away from their existing Azure DevOps Wiki repositories.
- Adding syntax that cannot degrade gracefully when viewed in the standard Azure DevOps Wiki.

## Architecture

PowerWiki is built as an Azure DevOps web extension that contributes an additional Power Wiki menu item and screen. The extension authenticates through Azure DevOps extension mechanisms and interacts with the existing project wiki repositories through Azure DevOps REST APIs, Wiki APIs, Git APIs, Comments APIs, and Work Item Tracking APIs.

The renderer is isolated behind a clear boundary so Markdown and Mermaid dependencies can be upgraded without rewriting wiki navigation, editing, or persistence code.

The current implementation follows the Microsoft Azure DevOps web extension structure with:

- `vss-extension.json` as the root extension manifest.
- `azure-devops-extension-sdk` for host initialization.
- `azure-devops-extension-api` for Azure DevOps service clients.
- Webpack and TypeScript for a production-style bundled hub page.
- React for the wiki screen shell.
- Monaco Editor for Markdown editing.
- Markdown and Mermaid rendering isolated under `src/rendering`.

The manifest contributes Power Wiki as a project-level hub group and also under the Azure DevOps project Overview menu. It intentionally does not replace or hide the default Azure DevOps Wiki, so teams can choose either experience.

### Permissions

The extension requests these scopes in `vss-extension.json`:

- `vso.wiki_write` — read and write wiki pages, page moves, and comments.
- `vso.work` — read work items and saved queries for inline badges and embedded query tables.
- `vso.code` — read the wiki's backing Git repository. This is used only to read each page's last commit so the byline can show who last edited the page and when; adding it requires a one-time re-authorization by an organization administrator.

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

The manifest uses the `dataversepowertools` publisher and the shared Dataverse PowerTools PNG logo asset from `media/logo_new.png`.

## Build and Test

Run TypeScript validation:

```bash
npm run typecheck
```

Build the extension assets into `dist/`:

```bash
npm run build
```

Run the test suite (TypeScript validation + Vitest unit tests):

```bash
npm test
```

`npm test` runs `tsc --noEmit` followed by the Vitest unit tests. The unit tests
(`npm run test:unit`) cover the Markdown rendering pipeline and Azure Boards
plugins with fixtures under `src/rendering/*.test.ts`, plus the shell error
boundary, so CommonMark/GFM and Mermaid upgrades stay deliberate.

For end-to-end verification against the published extension inside Azure DevOps,
use the Playwright harness (`npm run pw:verify`) — see `tools/pw/README.md` and
the "Verifying in the browser" section of `agents.md`.

Create a VSIX package:

```bash
npm run package:vsix
```

The package command uses `tfx-cli` and `vss-extension.json`, matching the Microsoft Azure DevOps extension packaging flow.

## Current Functionality

The current implementation provides a working Power Wiki experience:

- Initializes inside Azure DevOps using the extension SDK.
- Loads the current project context.
- Lists available project wikis through the Azure DevOps Wiki client.
- Lists wiki pages and builds a navigable, collapsible page tree with lazy-loaded children.
- Supports URL hash deep links and browser back/forward navigation for wiki pages.
- Loads selected page Markdown from the standard Azure DevOps Wiki backing store.
- Renders Markdown through the PowerWiki Markdown pipeline.
- Renders Mermaid diagrams through the bundled Mermaid runtime, including standard fenced blocks and Azure DevOps `::: mermaid` blocks.
- Renders inline work item references such as `#1234` as Azure Boards badges that open the native work item form.
- Renders embedded saved query tables written as `::: query-table <query-id> :::`, with a native Azure DevOps query link when hosted by Azure DevOps Services.
- Opens a Monaco-powered Markdown editor from the page actions menu and saves page content back through the Azure DevOps Wiki API with ETag-based concurrency.
- Provides editor formatting helpers for headings, emphasis, code, lists, links, and starter Mermaid diagrams.
- Creates new pages, opens them directly in edit mode, deletes pages, moves pages, and supports drag-and-drop tree reordering through Azure DevOps Wiki page APIs.
- Resolves relative wiki images and Azure DevOps-hosted image URLs back to the wiki Git repository item API.
- Shows the last known page edit author/date from Git history when available.
- Lists and adds top-level page comments through the Azure DevOps comments APIs.
- Page history from Git commits with a side-by-side Monaco diff and restore-through-edit.
- Follow/unfollow pages via Azure DevOps notification subscriptions (same contract as the built-in wiki).
- Attachment management: browse and insert existing attachments with image previews.
- Inbound-link updates on page rename/move, with a preview/confirm dialog.
- Word (.docx) and PDF export: single page or an ordered multi-page set, with native Word heading styles, native Word math (OMML), Mermaid images, query tables, and embedded HTML.
- Editor power tools: slash-command palette, keyboard shortcuts, page-link and attachment pickers, autosave draft recovery, and in-context rich-text table editing.
- Resolves `@<identity-guid>` mentions to display names, matching the built-in wiki.
- Supports the Azure DevOps image-size suffix, `![alt](image.png =500x250)`.
- Resizable page tree rail (drag its edge, double-click to reset), and an editor that fills the available height.

## Theming

PowerWiki follows the active Azure DevOps theme. The extension styles the UI through `--pw-*` tokens in `src/app/styles.css`, which map to host variables such as `--background-color`, `--text-primary-color`, and `--communication-foreground`.

For components that need a binary theme decision, `src/app/themeMode.ts` infers light or dark mode from the luminance of the host CSS variables instead of matching specific theme names. That keeps built-in and custom Azure DevOps themes working. Monaco switches between `vs` and `vs-dark`, and Markdown preview re-renders Mermaid diagrams with the matching Mermaid light or dark theme when Azure DevOps raises theme change events.

## Azure Boards Markdown Enhancements

PowerWiki adds read-only Azure Boards rendering on top of normal wiki Markdown:

```markdown
::: query-table 9a0fb95d-55b7-4fd3-af6b-30b8921ada61 :::
```

The query table syntax runs the saved query by ID in the current project and renders up to 200 matching work items inside the page. The embedded table is PowerWiki UI because Azure DevOps does not expose the built-in query grid as a reusable extension control. The table includes a link to open the query in the native Azure DevOps query experience when a hosted organization URL can be built.

Inline work item references like `#1234` render as clickable badges in PowerWiki. Clicking a badge opens the native Azure DevOps work item form through the Work Item Tracking extension service.

In the built-in Azure DevOps Wiki, these remain readable as plain Markdown text rather than requiring a proprietary stored page format.

### Identity mentions

Azure DevOps stores a mention as `@<identity-guid>` and resolves the name when it renders the page. PowerWiki does the same, so mentions read as `@Ada Lovelace` instead of a raw GUID, and group mentions drop the `[project]\` scope prefix the platform adds.

The lookup goes through the host's identity service contribution (`ms.vss-features.identity-service`, the service behind the Azure DevOps people picker) rather than the Identities or Graph REST APIs. The host performs it in the parent frame under the signed-in user's own session, so **PowerWiki does not request the `vso.identity` or `vso.graph` scope**. That matters operationally: adding a scope parks every installed copy of the extension at "Pending review" until an organization admin re-approves it.

An identity that cannot be resolved (a deleted user, or a host that does not expose the service) renders as a neutral `@unknown user` chip with the GUID on hover, never as the raw tag. The stored Markdown is never rewritten.

### Image size

PowerWiki supports the Azure DevOps [image-size syntax](https://learn.microsoft.com/en-us/azure/devops/project/wiki/markdown-guidance?view=azure-devops#image-size):

```markdown
![Image alt text](./image.png =500x250)
![Image alt text](./image.png =500x)
```

CommonMark expects a quoted title in that position, so stock markdown-it rejects the whole image and renders the author's Markdown as literal text. PowerWiki parses the suffix into `width`/`height` attributes ahead of the built-in image rule, using markdown-it's own link helpers so bracket nesting and `<...>` destinations keep working. Sizes survive the rich-text round trip and are honored by the Word export; images are capped at the column width so an oversized value cannot break the layout.

### Headings without a space

CommonMark requires a space after the hashes, so `#Overview` renders as a literal paragraph in the built-in Azure DevOps Wiki. PowerWiki also accepts the spaceless form (`#Overview`, `###Release notes`, levels one through six) and renders it as the matching heading, complete with anchor id and permalink.

The one exception is a hash run followed immediately by a digit: `#1234` stays an Azure Boards work item reference, because that shorthand is far more common in wiki text than a heading whose title starts with a number. Write `# 2024 roadmap` with the space when a heading really does begin with digits. This is an intentional difference from the built-in wiki — the stored Markdown is untouched, but a spaceless heading renders as a paragraph there.

## Project Structure

- `public/` contains static hub HTML copied into `dist/`.
- `src/extension/` contains Azure DevOps extension host initialization and entry points.
- `src/app/` contains the PowerWiki screen shell, page tree, editor, comments panel, and theme mode helper.
- `src/rendering/` contains Markdown, Mermaid, and sanitization boundaries.
- `src/wiki/` contains wiki repository/page/comment abstractions and Azure DevOps API access.
- `src/workItems/` contains Azure Boards work item and query access used by Markdown enhancements.
- `vss-extension.json` defines the Azure DevOps extension metadata and contributions.
- `overview.md` provides Marketplace package details.

## Publishing

The repository is configured for the `dataversepowertools` publisher and a public Marketplace listing. Before publishing a change, increment only the patch version in both `package.json` and `vss-extension.json`, then run:

```powershell
npm run build
$pat = (Get-Content C:\Users\peter\sources\repos\PowerWiki\ado.pat -Raw).Trim()
npx tfx-cli extension publish --manifest-globs vss-extension.json --token $pat
```

## Contributing

Contributions should preserve the core principle of PowerWiki: Azure DevOps remains the wiki system of record, while this extension provides a more capable editing and rendering experience.

Before implementing a feature, compare it with the current Azure DevOps Wiki behavior and document any intentional differences.
