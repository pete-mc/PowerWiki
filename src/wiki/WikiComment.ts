/** The backing-Git identity of a wiki page, needed for comments and history. */
export interface WikiPageMeta {
  readonly gitItemPath?: string;
  readonly id?: number;
}

/** The most recent change to a wiki page, derived from its Git history. */
export interface WikiPageChange {
  readonly authorName?: string;
  readonly date?: string;
}

/** One revision of a wiki page (a Git commit that touched its file). */
export interface WikiPageRevision {
  readonly commitId: string;
  readonly authorName?: string;
  readonly date?: string;
  readonly comment?: string;
  /** Git item path of the page's file at that revision. */
  readonly gitItemPath: string;
}

/** A single comment on a wiki page. */
export interface WikiComment {
  readonly authorImageUrl?: string;
  readonly authorName?: string;
  readonly createdDate?: string;
  readonly id: number;
  readonly parentId?: number;
  readonly text: string;
}
