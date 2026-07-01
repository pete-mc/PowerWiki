export interface WikiPage {
  readonly content: string;
  readonly id?: number;
  readonly path: string;
  readonly version?: string;
}

export interface WikiSummary {
  readonly id: string;
  readonly name: string;
  readonly remoteUrl?: string;
}

export interface WikiPageSummary {
  readonly id: number;
  readonly path: string;
}
