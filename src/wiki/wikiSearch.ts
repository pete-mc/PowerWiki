// Server-side wiki search, via the Azure DevOps Search service.
//
// The alternative is loading every page's Markdown and searching it in the
// browser (see wikiContentIndex), which costs one REST call per page and does
// not scale past a few hundred pages. This uses the same index the built-in
// wiki search uses, so results and ranking match what people already expect.
//
// Note the different host: the search service lives on almsearch.dev.azure.com,
// not dev.azure.com, so this cannot go through the generated REST clients —
// azure-devops-extension-api ships no Search client. Hence the hand-rolled
// request. The `vso.wiki` scope covers searching as well as reading, so this
// needs no manifest scope beyond the one the extension already requests.

/** A contiguous run of snippet text, flagged if the service marked it a match. */
export interface WikiSearchSegment {
  readonly text: string;
  readonly isMatch: boolean;
}

export interface WikiSearchHit {
  /** Wiki page path, e.g. "/PowerWiki Showcase/Mermaid Gallery". */
  readonly path: string;
  readonly fileName: string;
  readonly wikiName?: string;
  readonly projectName?: string;
  /** Snippets around each match, already split into safe segments. */
  readonly snippets: readonly (readonly WikiSearchSegment[])[];
}

export type WikiSearchStatus =
  /** Results are usable. */
  | { readonly kind: "ok"; readonly trimmed: boolean }
  /** The index is not ready yet; this is transient and worth retrying. */
  | { readonly kind: "indexing"; readonly message: string }
  /** The service understood the request but will not run this query. */
  | { readonly kind: "unsupported-query"; readonly message: string }
  | { readonly kind: "unknown"; readonly infoCode: number };

export interface WikiSearchOutcome {
  readonly status: WikiSearchStatus;
  readonly total: number;
  readonly hits: readonly WikiSearchHit[];
}

/**
 * Maps the service's numeric infoCode to something the UI can act on.
 *
 * This matters more than it looks: an unindexed organization answers a valid
 * query with HTTP 200, count 0 and an infoCode saying why. Ignoring the code
 * renders "no results found" when the truth is "the index is still building",
 * which is the difference between a user retrying and a user concluding their
 * content is missing.
 */
export function interpretInfoCode(infoCode: number): WikiSearchStatus {
  switch (infoCode) {
    case 0:
      return { kind: "ok", trimmed: false };
    case 8:
      // Results were capped at the service maximum; what came back is still good.
      return { kind: "ok", trimmed: true };
    case 1:
      return { kind: "indexing", message: "This organization's search index is being rebuilt." };
    case 2:
      return { kind: "indexing", message: "Search indexing has not started for this organization yet." };
    case 6:
    case 7:
      return { kind: "indexing", message: "This organization is still being onboarded to search." };
    case 9:
      return { kind: "indexing", message: "Branches are still being indexed." };
    case 3:
      return { kind: "unsupported-query", message: "The search service rejected this query." };
    case 4:
      return { kind: "unsupported-query", message: "Queries starting with a wildcard are not supported." };
    default:
      return { kind: "unknown", infoCode };
  }
}

/**
 * Converts a Git file path in the wiki repository to the wiki page path.
 *
 * Page titles are stored with spaces replaced by hyphens, so a literal hyphen
 * in a title has to survive somehow: Azure DevOps escapes it as `%2D`. Undo the
 * two in that order — `%2D` contains no hyphen, so the space substitution
 * cannot corrupt it, but doing it the other way round would.
 */
export function pagePathFromGitPath(gitPath: string): string {
  const withoutExtension = gitPath.replace(/\.md$/i, "");
  return withoutExtension
    .split("/")
    .map((segment) => segment.replace(/-/g, " ").replace(/%2D/gi, "-"))
    .join("/");
}

/**
 * Splits a highlighted snippet into text segments.
 *
 * The service marks matches with `<highlighthit>` tags inside content it took
 * from the wiki, so the snippet is attacker-influenced markup. Returning
 * segments rather than an HTML string keeps that off any innerHTML path.
 */
export function parseHighlight(highlight: string): readonly WikiSearchSegment[] {
  const segments: WikiSearchSegment[] = [];
  const pattern = /<highlighthit>([\s\S]*?)<\/highlighthit>/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(highlight)) !== null) {
    if (match.index > cursor) {
      segments.push({ text: highlight.slice(cursor, match.index), isMatch: false });
    }
    segments.push({ text: match[1], isMatch: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < highlight.length) {
    segments.push({ text: highlight.slice(cursor), isMatch: false });
  }
  return segments;
}

interface RawWikiSearchResponse {
  readonly count?: number;
  readonly infoCode?: number;
  readonly results?: readonly {
    readonly fileName?: string;
    readonly path?: string;
    readonly wiki?: { readonly name?: string };
    readonly project?: { readonly name?: string };
    readonly hits?: readonly { readonly highlights?: readonly string[] }[];
  }[];
}

export function toOutcome(body: RawWikiSearchResponse): WikiSearchOutcome {
  return {
    status: interpretInfoCode(body.infoCode ?? 0),
    total: body.count ?? 0,
    hits: (body.results ?? []).map((result) => ({
      path: pagePathFromGitPath(result.path ?? ""),
      fileName: result.fileName ?? "",
      wikiName: result.wiki?.name,
      projectName: result.project?.name,
      snippets: (result.hits ?? []).flatMap((hit) => (hit.highlights ?? []).map(parseHighlight))
    }))
  };
}

export interface WikiSearchRequest {
  readonly organizationName: string;
  readonly projectName: string;
  readonly searchText: string;
  readonly top?: number;
  readonly skip?: number;
}

/** Injected so tests exercise the mapping without a network or the SDK. */
export type SearchTransport = (url: string, body: unknown) => Promise<RawWikiSearchResponse>;

export async function searchWiki(
  request: WikiSearchRequest,
  transport: SearchTransport
): Promise<WikiSearchOutcome> {
  const url =
    `https://almsearch.dev.azure.com/${encodeURIComponent(request.organizationName)}` +
    `/${encodeURIComponent(request.projectName)}/_apis/search/wikisearchresults?api-version=7.1`;
  const body = await transport(url, {
    searchText: request.searchText,
    $skip: request.skip ?? 0,
    $top: request.top ?? 50
  });
  return toOutcome(body);
}
