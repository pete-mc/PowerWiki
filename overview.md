# PowerWiki

PowerWiki brings a modern wiki experience to Azure DevOps without touching your existing content. It adds a **Power Wiki** menu alongside the built-in Azure DevOps Wiki and continues to use your standard wiki Git repositories as the single source of truth.

No migration. No proprietary formats. Just better reading and editing for the Markdown and Mermaid you already have.

## Why PowerWiki?

- Use the latest Markdown and Mermaid rendering instead of the frozen versions bundled in Azure DevOps.
- Edit with a full-featured Monaco editor (the same editor that powers VS Code).
- Get rich Azure Boards integration that still renders as readable plain text in the standard wiki.
- Keep the familiar Azure DevOps Wiki experience available for your whole team — PowerWiki is purely additive.

## Key Features

- **Modern rendering**
  - Current CommonMark + GFM pipeline with heading anchors.
  - Full support for `[[_TOC_]]` and `[[_TOSP_]]` placeholders.
  - Up-to-date Mermaid (v11) with automatic light/dark theme support. Works with both standard ````mermaid` fences and Azure DevOps-style `::: mermaid` blocks.

- **Powerful editing**
  - Monaco-based Markdown editor with word wrap, syntax awareness, and comfortable editing.
  - Save changes directly back to your Azure DevOps wiki repository.

- **Azure Boards enhancements** (portable by design)
  - `#1234` references render as clickable work item badges that open the native work item form.
  - Embed live query results with `::: query-table <query-id> :::` — renders a table of matching work items with a link back to the original query.

- **Navigation & structure**
  - Switch between multiple project wikis.
  - Hierarchical page tree with lazy-loaded children.
  - Deep linking and in-page navigation that feels native.
  - Relative images and attachments from your wiki are resolved and displayed correctly.

## How It Works

PowerWiki reads and writes the exact same wiki pages stored in your project's Azure DevOps Git wiki repositories. Everything you edit is stored as normal Markdown — fully compatible with the built-in Azure DevOps Wiki, clone, and any other tools that consume the repository.

## Requirements & Scope

- Requires an Azure DevOps project with at least one wiki.
- Works for both Azure DevOps Services and Server (where extension APIs are available).
- Current focus: excellent page viewing and content editing. Page creation, renaming, deletion, attachment management, full page history, and search are on the roadmap.

Choose the experience that works best for you on any given day. Your wiki content stays exactly where it belongs.
