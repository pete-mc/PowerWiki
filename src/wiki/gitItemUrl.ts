// Authenticated Azure DevOps Git Items API URL for a file in a wiki repository.
// Used to display attachment images, which are not reachable as a plain
// cross-origin <img src>.

import { joinRepositoryPath } from "./repositoryItemPath";
import type { WikiSummary } from "./WikiPage";

export function buildGitItemUrl(
  wiki: WikiSummary,
  wikiPath: string
): string | undefined {
  if (!wiki.repositoryId || !wiki.remoteUrl) {
    return undefined;
  }

  try {
    const remoteUrl = new URL(wiki.remoteUrl);
    const gitIndex = remoteUrl.pathname.toLowerCase().indexOf("/_git/");
    if (gitIndex === -1) {
      return undefined;
    }

    const repositoryPath = joinRepositoryPath(wiki.mappedPath, wikiPath);
    const apiBasePath = remoteUrl.pathname.slice(0, gitIndex);
    const url = new URL(
      `${remoteUrl.origin}${apiBasePath}/_apis/git/repositories/${encodeURIComponent(wiki.repositoryId)}/Items`
    );
    url.searchParams.set("path", repositoryPath);
    url.searchParams.set("download", "true");
    return url.toString();
  } catch {
    return undefined;
  }
}
