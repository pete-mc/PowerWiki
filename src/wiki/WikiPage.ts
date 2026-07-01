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
  readonly remoteUrl?: string;
}

export interface WikiPageSummary {
  readonly id: number;
  readonly isParentPage: boolean;
  readonly order: number;
  readonly path: string;
}
