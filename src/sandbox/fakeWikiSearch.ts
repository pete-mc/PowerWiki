import type { SearchTransport } from "../wiki/wikiSearch";
import type { SeedPage } from "./FakeWikiRepositoryClient";

/**
 * An in-memory stand-in for the Azure DevOps Search service, for the sandbox.
 *
 * The sandbox has no organization, no SDK and no network, so the real transport
 * (`wiki/wikiSearchTransport.ts`) cannot run there. This answers in the service's
 * own wire shape — Git file paths, `<highlighthit>` markers, an `infoCode` —
 * rather than in PowerWiki's mapped shape, so the mapping in `wiki/wikiSearch.ts`
 * is exercised too instead of being bypassed.
 *
 * `infoCode` is settable because the states that matter most in the UI are the
 * ones a healthy organization never produces: an index that is still building
 * answers a valid query with zero results and a code explaining why.
 */
export interface FakeWikiSearchOptions {
  /** Forced service status; 0 (usable results) unless a state is being demonstrated. */
  readonly infoCode?: number;
  /** Artificial delay, so the searching state is visible. */
  readonly latencyMs?: number;
  readonly wikiName?: string;
  readonly projectName?: string;
}

const SNIPPET_CONTEXT = 40;
const MAX_SNIPPETS = 3;

export function createFakeWikiSearchTransport(
  pages: readonly SeedPage[],
  options: FakeWikiSearchOptions = {}
): SearchTransport {
  const { infoCode = 0, latencyMs = 120, projectName = "Sandbox", wikiName = "Sandbox.wiki" } = options;

  return async (_url, body) => {
    await new Promise((resolve) => setTimeout(resolve, latencyMs));

    const request = body as { searchText?: unknown; $top?: unknown };
    const searchText = String(request.searchText ?? "").trim();
    const top = Number(request.$top ?? 50);

    if (infoCode !== 0 || !searchText) {
      return { count: 0, infoCode, results: [] };
    }

    const needle = searchText.toLowerCase();
    const results = pages
      .filter((page) => page.content.toLowerCase().includes(needle))
      .slice(0, Number.isFinite(top) ? top : 50)
      .map((page) => ({
        fileName: `${gitPath(page.path).split("/").at(-1)}`,
        path: gitPath(page.path),
        wiki: { name: wikiName },
        project: { name: projectName },
        hits: [{ highlights: highlightsFor(page.content, needle) }]
      }));

    return { count: results.length, infoCode: 0, results };
  };
}

/**
 * The inverse of `pagePathFromGitPath`: page paths become Git file paths, with
 * spaces hyphenated and a literal hyphen escaped as `%2D`.
 *
 * Doing this properly is what keeps a sandbox result clickable — the UI maps the
 * path back the same way the real service's results are mapped, so an escaping
 * mistake here would show up as "page not found" exactly as it would in
 * production.
 */
function gitPath(pagePath: string): string {
  const escaped = pagePath
    .split("/")
    .map((segment) => segment.replace(/-/g, "%2D").replace(/ /g, "-"))
    .join("/");
  return `${escaped}.md`;
}

/** Snippets around the first few matches, marked the way the service marks them. */
function highlightsFor(content: string, needle: string): string[] {
  const haystack = content.toLowerCase();
  const highlights: string[] = [];
  let cursor = 0;

  while (highlights.length < MAX_SNIPPETS) {
    const index = haystack.indexOf(needle, cursor);
    if (index < 0) {
      break;
    }
    const start = Math.max(0, index - SNIPPET_CONTEXT);
    const end = Math.min(content.length, index + needle.length + SNIPPET_CONTEXT);
    highlights.push(
      content.slice(start, index) +
        `<highlighthit>${content.slice(index, index + needle.length)}</highlighthit>` +
        content.slice(index + needle.length, end)
    );
    cursor = index + needle.length;
  }

  return highlights;
}
