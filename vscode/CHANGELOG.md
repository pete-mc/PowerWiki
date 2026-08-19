# Changelog

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
