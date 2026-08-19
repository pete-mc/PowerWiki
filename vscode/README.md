# ADO PowerWiki for VS Code

Browse, search and edit a **cloned Azure DevOps wiki** as an ordinary folder,
with PowerWiki's Markdown, Mermaid, KaTeX and draw.io rendering. No Azure DevOps
connection, no sign-in, no PAT — everything comes from the files on disk and
`git`.

The Explorer is the page tree. Click a Markdown file that belongs to a wiki and
it opens as a rendered page instead of raw text.

> **Working in Azure DevOps too?** [**PowerWiki for Azure DevOps**](https://marketplace.visualstudio.com/items?itemName=dataversepowertools.powerwiki) is
> the companion extension: the same rendering, editing and export, as a hub next
> to the built-in wiki — plus comments, follow, and live Azure Boards work item
> badges and query tables, which need the service and so cannot work off a clone.
> The two share one codebase and read and write the same wiki repositories, so
> you can move between them freely.

## What works

| | |
|---|---|
| Browse and render | Markdown (CommonMark + GFM), Mermaid, KaTeX, callouts, `[[_TOSP_]]` |
| Navigate | Wiki links open the target page's file, so the Explorer stays in step |
| Search | Full-text across the wiki, with highlighted snippets |
| Edit | Code, split, and rich-text editors; drafts autosave |
| Page operations | Create, rename, move, reorder (`.order` is maintained), delete |
| Attachments | Insert, list, and **replace** — a local file has none of the API's create-only limits |
| Diagrams | draw.io round-trips, storing revisions in `.attachments` |
| History | `git log --follow`, so a renamed page keeps its whole history |
| Export | Word (.docx), saved through a file dialog — optionally through your own Word template |

## What is missing, and why

These need Azure DevOps itself, not the files, so they are **absent rather than
broken**:

- **Comments** — stored by the service, not in the repository.
- **Follow / notifications** — a subscription held by the service.
- **Work item badges and `@mentions`** — rendered exactly as written, with
  nothing fetched to fill them in. `#1234` stays `#1234`.
- **PDF export** — it works by printing the rendered document, and a VS Code
  webview has no print pipeline. Word export is offered instead; the PDF option
  is hidden rather than shown and doing nothing.

## Finding your wiki

Three layouts work with no configuration:

1. the wiki clone **is** the folder you opened;
2. the wiki is **one folder of a multi-root workspace**;
3. the wiki is a **subfolder** (a docs wiki inside a code repository).

A folder is treated as a wiki when it has a `.order` file, or Markdown plus an
`.attachments` folder. If yours is nested deeper than two levels, or looks like
neither, name it explicitly:

```jsonc
{
  "powerwiki.wikiRoots": ["docs/Product.wiki"],   // absolute, or relative to the first folder
  "powerwiki.discoveryDepth": 4,                  // how deep to search (default 2)
  "powerwiki.includeMarkdownFolders": false,      // treat any Markdown folder as a wiki
  "powerwiki.openWikiPagesInPowerWiki": true      // hand wiki pages to PowerWiki
}
```

Only Markdown *inside a detected wiki* is handed to PowerWiki; every other `.md`
file in the workspace opens as text as usual. **PowerWiki: Open as Markdown**
(also in the editor title bar) shows the raw source of the page you are on.

## Which tab a page opens in

Pages follow VS Code's own convention rather than inventing one. A single
Explorer click opens the page in the reusable **preview** tab, so browsing a
wiki — clicking through the tree, following links between pages — leaves one
tab, not a trail of them. Double-clicking, or starting to edit, makes the tab
permanent, and a page that is already open is revealed rather than opened again.

## Saving

Saving writes the file. It does **not** commit — that stays with your normal Git
workflow, unlike the Azure DevOps wiki where every save is a commit. When the
page is already open in a text editor, PowerWiki edits that document and saves
it, so the change lands in the undo stack rather than behind the editor's back.

## Commands

| Command | What it does |
|---|---|
| PowerWiki: Open in PowerWiki | Render the selected Markdown file as a page |
| PowerWiki: Open as Markdown | Show the current page's raw source |
| PowerWiki: Open Wiki Home | Open the home page of a wiki in the workspace |
| PowerWiki: Rescan Workspace for Wikis | Re-run discovery after moving folders |

## Building it from source

From the repository root:

```bash
npm ci
npm run build:vscode      # bundles the extension, webview and Monaco into vscode/dist
npm run package:vscode    # produces vscode/powerwiki-vscode.vsix
npm run test:vscode       # UI tests in a real VS Code window
```

Install the result with `code --install-extension vscode/powerwiki-vscode.vsix`,
or press **F5** in this repository to launch an Extension Development Host.

The extension shares its entire UI with the [Azure DevOps extension](https://marketplace.visualstudio.com/items?itemName=dataversepowertools.powerwiki); see
[`AGENTS.md`](../AGENTS.md) for the host boundary that makes that possible.
