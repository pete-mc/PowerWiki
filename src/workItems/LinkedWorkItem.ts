// Work items that link to a wiki page.
//
// Azure DevOps stores the relationship on the *work item*, as an `ArtifactLink`
// relation pointing at a `vstfs:///Wiki/WikiPage/...` URI (see
// `src/host/workItemWikiLinks.ts`). There is no wiki-side index, so the only way
// to answer "what links to this page?" is to ask work item tracking to resolve
// the artifact URI — which is what `ArtifactUriQuery` is for.
//
// That query is a read, covered by the `vso.work` scope the extension already
// declares. Showing this costs no new permission and no re-authorisation for
// installed organisations, which is the whole reason it is done this way rather
// than by keeping a list on the page.

/** A work item linking to the wiki page currently on screen. */
export interface LinkedWorkItem {
  readonly id: number;
  readonly title?: string;
  readonly type?: string;
  readonly state?: string;
  /**
   * The state's category — Proposed, InProgress, Resolved, Completed, Removed.
   * Process-independent, unlike `state`, which every process names differently.
   */
  readonly stateCategory?: string;
  readonly assignedToName?: string;
}

/** The linked work items for a page, with the icons needed to render them. */
export interface LinkedWorkItemsResult {
  readonly items: readonly LinkedWorkItem[];
  /**
   * Inline SVG markup keyed by work item type name, shown before the title.
   * Best-effort and decorative: a missing entry just means no icon.
   */
  readonly icons?: ReadonlyMap<string, string>;
}
