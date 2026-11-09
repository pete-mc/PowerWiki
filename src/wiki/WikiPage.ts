export interface WikiPage {
  readonly content: string;
  readonly id?: number;
  readonly path: string;
  readonly version?: string;
}

export interface WikiSummary {
  readonly id: string;
  readonly mappedPath?: string;
  readonly name: string;
  readonly repositoryId?: string;
  /** Backing Git repository URL (`.../_git/<repository>`), used for Git API URLs. */
  readonly repositoryRemoteUrl?: string;
  /** Wiki API URL (`.../_wiki/wikis/<id>`), not a Git repository URL. */
  readonly remoteUrl?: string;
  /** Branch the wiki is served from (e.g. "wikiMaster"), used for history lookups. */
  readonly version?: string;
}

export interface WikiPageSummary {
  readonly id: number;
  readonly isParentPage: boolean;
  readonly order: number;
  readonly path: string;
}

/** An uploaded wiki attachment stored under the wiki's `.attachments` folder. */
export interface WikiAttachment {
  /** File name as stored, e.g. "diagram-lk9f2.png". */
  readonly name: string;
  /** Wiki-relative path used to reference it, e.g. "/.attachments/diagram-lk9f2.png". */
  readonly path: string;
}
