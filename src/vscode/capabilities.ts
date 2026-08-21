// What the VS Code host can do — declared once.
//
// This was declared twice: `VS_CODE_CAPABILITIES` in `PowerWikiEditorProvider.ts`
// (sent to the webview in the init message) and again as the `capabilities`
// field of `VsCodeWikiHost`. Both had to agree, and nothing made them: the two
// halves of the same host would simply disagree about what it could do, with the
// webview showing UI for a feature the extension host had no handler for.
//
// It survived only because `WikiHostCapabilities` has no optional members, so
// adding one broke both at compile time. That is a lucky property of the
// interface, not a guarantee — a member with a default, or a change to one
// declaration's *value*, would go through silently.
//
// Every entry carries the reason it is false, because "why can't it do that?" is
// the question this file exists to answer.

import type { WikiHostCapabilities } from "../host/WikiHost";

export const VS_CODE_CAPABILITIES: WikiHostCapabilities = {
  // Comments are Azure DevOps service state, not files, so a clone has none.
  comments: false,
  // Following is a notification subscription held by the service.
  follow: false,
  // Nothing to resolve work items or mentions against offline; the renderer's
  // own fallback leaves them inert, exactly as written.
  workItems: false,
  mentions: false,
  // The VS Code Explorer is the page tree. A second tree beside it would be a
  // duplicate that could disagree.
  pageTree: false,
  // The work item form's rail, which only exists on the Azure DevOps side.
  linkedPages: false,
  // Off a clone there is no work item store to ask what links to a page.
  linkedWorkItems: false,
  // The editor tab has already chosen the wiki.
  wikiSelector: false,
  // A local scan over the wiki's files.
  search: true,
  // No shareable URL for a file on disk.
  permalinks: false,
  // PDF export renders the document and calls `window.print()`, and a webview
  // has no print pipeline. Word export still works: it produces bytes, which
  // the extension host writes to disk.
  printToPdf: false,
  // Already in VS Code; offering to open it there would be absurd.
  vsCodeHandoff: false
};
