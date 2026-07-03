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

/** A single comment on a wiki page. */
export interface WikiComment {
  readonly authorImageUrl?: string;
  readonly authorName?: string;
  readonly createdDate?: string;
  readonly id: number;
  readonly parentId?: number;
  readonly text: string;
}
