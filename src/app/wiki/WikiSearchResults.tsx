import { useEffect, useMemo, useState } from "react";

import type { WikiSearchHit, WikiSearchOutcome, WikiSearchSegment, WikiSearchStatus } from "../../wiki/wikiSearch";
import { matchWikiTitles, type WikiSearchablePage } from "./wikiTitleMatch";

/**
 * The nav rail's search results: instant title matches from the pages already in
 * memory, followed by content matches from the Azure DevOps Search service.
 *
 * The two halves are independent on purpose. Titles answer immediately and keep
 * working when the search service is unavailable or its index is not ready;
 * content matches are the part that needs the network.
 */
interface WikiSearchResultsProps {
  /** Name of the wiki being browsed, so hits from another wiki can be labelled. */
  readonly activeWikiName?: string;
  readonly onSelect: (path: string, wikiName?: string) => void;
  /** Runs a content search. Absent when there is no project context to search in. */
  readonly onSearchContent?: (searchText: string) => Promise<WikiSearchOutcome>;
  readonly pages: readonly WikiSearchablePage[];
  readonly query: string;
}

type ContentState =
  | { readonly kind: "idle" }
  | { readonly kind: "searching" }
  | { readonly kind: "done"; readonly outcome: WikiSearchOutcome }
  | { readonly kind: "failed"; readonly message: string };

// Long enough that typing a word does not fire a request per keystroke, short
// enough that the results feel like they are keeping up.
const SEARCH_DEBOUNCE_MS = 250;
const MAX_SNIPPETS_PER_HIT = 2;

export function WikiSearchResults({
  activeWikiName,
  onSearchContent,
  onSelect,
  pages,
  query
}: WikiSearchResultsProps) {
  const [contentState, setContentState] = useState<ContentState>({ kind: "idle" });
  const titleMatches = useMemo(() => matchWikiTitles(pages, query), [pages, query]);

  useEffect(() => {
    const searchText = query.trim();
    if (!onSearchContent || !searchText) {
      setContentState({ kind: "idle" });
      return;
    }

    // `cancelled` guards the response as well as the timer: a slow request for
    // an earlier query must not overwrite the results of a later one.
    let cancelled = false;
    setContentState({ kind: "searching" });
    const timer = window.setTimeout(() => {
      onSearchContent(searchText)
        .then((outcome) => {
          if (!cancelled) {
            setContentState({ kind: "done", outcome });
          }
        })
        .catch((searchError: unknown) => {
          if (!cancelled) {
            setContentState({ kind: "failed", message: formatError(searchError) });
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onSearchContent, query]);

  const outcome = contentState.kind === "done" ? contentState.outcome : undefined;
  // A page whose title already matched is listed above; repeating it with a
  // snippet doubles the list in a narrow rail without adding a destination.
  const titlePaths = useMemo(() => new Set(titleMatches.map((match) => match.path)), [titleMatches]);
  const contentHits = (outcome?.hits ?? []).filter((hit) => !titlePaths.has(hit.path));
  const notice = outcome ? statusNotice(outcome.status) : undefined;

  return (
    <div aria-label="Search results" className="powerwiki-search-results" role="region">
      {titleMatches.length > 0 ? (
        <section className="powerwiki-search-section">
          <h2 className="powerwiki-search-heading">Pages</h2>
          {titleMatches.map((match) => (
            <button
              className="powerwiki-search-hit"
              key={match.path}
              onClick={() => onSelect(match.path)}
              title={match.path}
              type="button"
            >
              <span className="powerwiki-search-hit-title">
                <HighlightedText segments={match.titleSegments} />
              </span>
              <span className="powerwiki-search-hit-path">{match.path}</span>
            </button>
          ))}
        </section>
      ) : null}

      <section className="powerwiki-search-section">
        <h2 className="powerwiki-search-heading">In page content</h2>

        {contentState.kind === "idle" && !onSearchContent ? (
          <p className="powerwiki-search-note">
            Content search needs an Azure DevOps project context, so only page titles are searched here.
          </p>
        ) : null}

        {contentState.kind === "searching" ? (
          <p className="powerwiki-search-note">Searching…</p>
        ) : null}

        {contentState.kind === "failed" ? (
          <p className="powerwiki-search-note powerwiki-search-note-warning" role="alert">
            {contentState.message}
          </p>
        ) : null}

        {/*
          Every non-"ok" status is reported. An organization whose index is not
          ready answers with HTTP 200, zero results and an infoCode saying why:
          rendering that as "no results" tells the user their content is missing
          when the index is merely still building.
        */}
        {notice ? (
          <p className="powerwiki-search-note powerwiki-search-note-warning" role="status">
            {notice}
          </p>
        ) : null}

        {contentHits.map((hit) => (
          <button
            className="powerwiki-search-hit"
            key={`${hit.wikiName ?? ""}${hit.path}`}
            onClick={() => onSelect(hit.path, hit.wikiName)}
            title={hit.path}
            type="button"
          >
            <span className="powerwiki-search-hit-title">{pageTitle(hit)}</span>
            <span className="powerwiki-search-hit-path">
              {hit.wikiName && hit.wikiName !== activeWikiName ? `${hit.wikiName} · ` : ""}
              {hit.path}
            </span>
            {hit.snippets.slice(0, MAX_SNIPPETS_PER_HIT).map((snippet, index) => (
              <span className="powerwiki-search-hit-snippet" key={index}>
                <HighlightedText segments={snippet} />
              </span>
            ))}
          </button>
        ))}

        {outcome && outcome.status.kind === "ok" && contentHits.length === 0 ? (
          <p className="powerwiki-search-note">
            {titleMatches.length > 0 ? "No further matches in page content." : "No page content matched."}
          </p>
        ) : null}
      </section>
    </div>
  );
}

/**
 * Renders pre-split snippet segments as text nodes, marking the matches.
 *
 * The segments come from wiki content wrapped in the service's own markup, so
 * they are attacker-influenced: they must reach the DOM as text (React escapes
 * them) and never as HTML.
 */
function HighlightedText({ segments }: { readonly segments: readonly WikiSearchSegment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.isMatch ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>
      )}
    </>
  );
}

/** The user-facing sentence for a status, or undefined when results are simply usable. */
function statusNotice(status: WikiSearchStatus): string | undefined {
  switch (status.kind) {
    case "ok":
      return status.trimmed ? "Showing the first matches only — narrow the search to see the rest." : undefined;
    case "indexing":
      return `${status.message} Content matches will be incomplete until indexing finishes.`;
    case "unsupported-query":
      return status.message;
    case "unknown":
      // Deliberately not silent: an unrecognised code must not look like an
      // empty result set.
      return `The search service returned an unrecognised status (code ${status.infoCode}). Content matches may be incomplete.`;
  }
}

function pageTitle(hit: WikiSearchHit): string {
  const segments = hit.path.split("/").filter(Boolean);
  return segments.at(-1) ?? hit.path;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Wiki search is unavailable.";
}
