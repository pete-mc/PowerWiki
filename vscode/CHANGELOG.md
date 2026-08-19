# Changelog

## 1.4.1

- Fixed links to pages whose title contains a hyphen surrounded by spaces —
  "List - Firewall rules" — which could not be opened
  ([#29](https://github.com/pete-mc/PowerWiki/issues/29)). Azure DevOps escapes
  such a hyphen as `%2D`, and the link resolver decoded that before working out
  which hyphens had been spaces, so the escape was lost.

## 1.4.0

Shared with the Azure DevOps extension 1.4.0.

- **Word export can use your own template.** Put `{{PowerWikiContent}}` in a
  `.docx` where the pages belong and the export keeps its cover page, headers,
  footers and styles around them; a template without that marker still lends its
  fonts and heading styles. Choose one per export, or commit
  `/.attachments/powerwiki-template.docx` to the wiki as the project default.
- Fixed the draw.io editor appearing to hang on save. The diagram was stored
  immediately; the wait was a wiki-wide scan for other pages using it, which now
  runs after the editor closes.
- Fixed a diagram's image not refreshing on the page after editing it.

The **Power Wiki tab on the work item form**, also new in 1.4.0, is Azure DevOps
only — there are no work items in VS Code.

## 1.3.11

- Fixed **Clone wiki in VS Code** (in the Azure DevOps extension), which handed
  git the wiki's *web* URL. Git followed the redirect to a sign-in page and
  failed with `unable to update url base from redirection`. The clone URL is now
  read from the repository itself, and the action is hidden when there is not
  one.

## 1.3.10

Version numbers now track the Azure DevOps extension, so a given version means
the same PowerWiki in both places.

- Renamed to **ADO PowerWiki for VS Code**, so it is distinguishable from the
  Azure DevOps extension of the same name.
- New icon. The old one was the brand logo as-is — a near-black glyph on
  transparency — which was invisible against the VS Code Extensions view in any
  dark theme. It now carries its own background.
- Links to the Azure DevOps extension from the Marketplace listing.

## 0.1.2 (unreleased)

- Renamed to **ADO PowerWiki for VS Code**, so it is distinguishable from the
  Azure DevOps extension of the same name.
- New icon. The old one was the brand logo as-is — a near-black glyph on
  transparency — which was invisible against the VS Code Extensions view in any
  dark theme. It now carries its own background. `tools/media/make-vscode-icon.mjs`
  generates it, and the release refuses to publish a transparent one.

## 0.1.1

- Pages reuse the editor tab instead of opening a new one each time, and a page
  that is already open is revealed rather than opened again.
- Fixed wiki pages sometimes opening twice: the Explorer hand-off's guard
  cleared itself on the first read, and the text editor VS Code had already
  opened was left open beside the new one.
- Fixed **PowerWiki: Open as Markdown**, which bounced straight back to the
  rendered page.

## 0.1.0

First release. Browse, search and edit a cloned Azure DevOps wiki with no
connection to Azure DevOps.

- The built-in Explorer is the page tree; clicking a wiki page opens it rendered.
- Markdown (CommonMark + GFM), Mermaid, KaTeX, callouts and `[[_TOSP_]]`.
- Full-text search across the wiki, with highlighted snippets.
- Code, split and rich-text editors, with autosaved drafts.
- Create, rename, move, reorder and delete pages, maintaining `.order`.
- Attachments, including replacing them — a local file has none of the wiki
  attachment API's create-only limits.
- draw.io diagrams, round-tripped into `.attachments`.
- Page history via `git log --follow`, so a renamed page keeps its history.
- Word export.

Comments, follow/notifications, work item badges and `@mention` resolution need
Azure DevOps itself, so they are absent or inert rather than broken. PDF export
is unavailable because it works by printing, which a VS Code webview cannot do.
