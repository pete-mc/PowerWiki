# PowerWiki — a modern wiki for Azure DevOps

**The wiki you already have, the experience it deserves.** PowerWiki adds a Power Wiki hub next to the built-in Azure DevOps Wiki and reads and writes the *same* wiki Git repositories. No migration, no proprietary formats, no lock-in — turn it off tomorrow and your wiki is untouched.

![PowerWiki rendering a wiki page with work item badges, an embedded Azure Boards query table, a per-page byline, and a Mermaid diagram](https://dataversepowertools.gallerycdn.vsassets.io/extensions/dataversepowertools/powerwiki/1.2.3/1783171403078/media/screenshots/powerwiki-rendering.png)

## Why teams switch

- 🧜 **Today's Mermaid, today's Markdown.** Mermaid v11 (architecture, kanban, sankey, xy-chart, mindmap, timeline and more), GitHub-style callouts, KaTeX math, syntax-highlighted code — instead of the frozen renderers bundled with Azure DevOps.
- 📤 **Export to Word and PDF.** Turn one page — or an ordered set of pages — into a real `.docx` with native Word heading styles and equations, or a print-perfect PDF. Diagrams, query tables, and images included.
- 🕑 **Never lose the thread.** Page history with side-by-side diffs and one-click restore, follow pages for change notifications, and safe renames that fix inbound links for you.
- 🧩 **Azure Boards, live on the page.** `#1234` becomes a rich work item badge; `::: query-table <id> :::` embeds live query results — and both stay readable as plain text in the built-in wiki.
- ✍️ **An editor you'll actually enjoy.** Monaco (the VS Code editor) with a `/` command palette, keyboard shortcuts, page-link and attachment pickers, autosaved drafts, and a WYSIWYG mode with in-context table editing.

## Reading, upgraded

- Current CommonMark + GFM pipeline, `[[_TOC_]]` and `[[_TOSP_]]` support, and native-feeling deep links.
- Mermaid v11 with automatic light/dark theming, a fit-to-screen pan/zoom viewer, and SVG download. Works with ` ```mermaid ` fences and `::: mermaid` blocks alike.
- LaTeX math with KaTeX (`$inline$` and `$$display$$`).
- Callouts (`> [!NOTE]`, `[!TIP]`, `[!WARNING]`…), heading permalinks that copy a shareable Azure DevOps link, click-to-zoom images, and copy buttons on code blocks.
- Per-page byline (last editor and time, straight from Git history) and page comments.

![Mermaid v11 diagrams rendered by PowerWiki with a pan-and-zoom viewer and SVG export](https://dataversepowertools.gallerycdn.vsassets.io/extensions/dataversepowertools/powerwiki/1.2.3/1783171403078/media/screenshots/powerwiki-mermaid.png)

![KaTeX math rendering with inline and display equations](https://dataversepowertools.gallerycdn.vsassets.io/extensions/dataversepowertools/powerwiki/1.2.3/1783171403078/media/screenshots/powerwiki-math.png)

## Writing, without friction

- **Monaco Markdown editor** with live split preview, word wrap, and Azure DevOps theming.
- **Type `/` for anything**: headings, tables, code blocks, every Mermaid diagram type, draw.io diagrams, work-item references, query tables, links.
- **Ctrl+B / Ctrl+I / Ctrl+K**, a searchable page-link picker, and an attachment picker for files you've already uploaded.
- **Paste or drop images** into any editor — they upload to `.attachments` and the reference is inserted for you.
- **Rich text mode** with a floating table toolbar: insert, delete, and reorder rows and columns right at the table.
- **Never lose work**: unsaved-changes protection on refresh/close and local draft autosave with one-click recovery.

![PowerWiki split editor with Monaco Markdown source, live preview, and the slash command palette](https://dataversepowertools.gallerycdn.vsassets.io/extensions/dataversepowertools/powerwiki/1.2.3/1783171403078/media/screenshots/powerwiki-editing.png)

## Diagrams you can actually edit

- **Draw with draw.io, without leaving the wiki.** Hit **Diagram** in the editor toolbar (or type `/diagram`) for a full draw.io canvas — shapes, connectors, the whole shape library.
- **Edit any diagram in place.** Hover a diagram on a page and click **Edit diagram**. It reopens exactly as you drew it, not as a flat picture.
- **Reuse one diagram across many pages.** Reference the same diagram wherever it's relevant; edit it from any of those pages and every page updates. No more six stale copies of the same architecture diagram.
- **Stored as a normal image.** Each diagram is saved to `.attachments` as a `.drawio.png` — a real PNG that happens to carry its own source. It renders in the built-in Azure DevOps Wiki, drops into Word and PDF exports like any other image, and keeps working if you ever stop using PowerWiki.
- **Nothing leaves your browser.** The editor loads only while you have it open, and diagram content is exchanged in-page rather than uploaded to a third party. Pages with diagrams on them never contact diagrams.net at all.

## History and stewardship

- **Page history** from Git: browse revisions, compare side by side (changes per revision or against current), and restore any version through the normal save path.
- **Follow pages** to get Azure DevOps notifications when they change — the same subscriptions the built-in wiki uses.
- **Attachment manager**: browse everything in `.attachments` with previews and copy Markdown references in a click.
- **Safe renames**: when you move or rename a page, PowerWiki finds every inbound link, shows you the affected pages, and updates them on confirm.

![Page history with a side-by-side Monaco diff and restore](https://dataversepowertools.gallerycdn.vsassets.io/extensions/dataversepowertools/powerwiki/1.2.3/1783171403078/media/screenshots/powerwiki-history.png)

## Export that looks like you spent all day on it

- **Word (.docx)**: Markdown headings become real Word heading styles (navigation pane ready), equations become native editable Word math, Mermaid renders as crisp images, and tables/images/query results come across.
- **PDF**: full-fidelity print with selectable text.
- Export one page, or select and order any set of pages from a tree into a single document.

![Export dialog with Word and PDF formats and multi-page selection](https://dataversepowertools.gallerycdn.vsassets.io/extensions/dataversepowertools/powerwiki/1.2.3/1783171403078/media/screenshots/powerwiki-export.png)

## Your content stays yours

PowerWiki stores nothing outside your wiki's Git repository. Every page remains plain, portable Markdown that renders in the built-in wiki, in clones, and in any Markdown tool. PowerWiki-specific niceties (badges, query tables, callouts) degrade to readable text everywhere else. The built-in wiki stays available to your whole team — PowerWiki is purely additive.

## Requirements & permissions

- An Azure DevOps project with at least one wiki (Services; Server where extension APIs are available).
- Scopes: **Wiki (read/write)** for pages and attachments; **Work Items (read)** for badges and query tables; **Code (read)** for page history, the byline, and attachment listings from the wiki's Git repository; **Notifications (write)** for follow/unfollow page subscriptions.
- Light, dark, and custom Azure DevOps themes are detected automatically.

Install it, open **Power Wiki** in your project, and give your wiki the experience it deserves.
