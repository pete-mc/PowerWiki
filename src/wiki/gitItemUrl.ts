// Authenticated Azure DevOps Git Items API URL for a file in a wiki repository.
// Used to display attachment images, which are not reachable as a plain
// cross-origin <img src>.

import { joinRepositoryPath } from "./repositoryItemPath";
import type { WikiSummary } from "./WikiPage";

export function buildGitItemUrl(
  wiki: WikiSummary,
  projectName: string,
  wikiPath: string
): string | undefined {
  if (!wiki.repositoryId || !wiki.remoteUrl) {
    return undefined;
  }

  const remoteUrl = new URL(wiki.remoteUrl);
  const repositoryPath = joinRepositoryPath(wiki.mappedPath, wikiPath);

  // On dev.azure.com the remoteUrl path is /{org}/{project}/_git/{repo}, so the
  // Items API URL must be /{org}/{project}/_apis/... On legacy visualstudio.com
  // the org is the subdomain and the path starts with /{project}/_git/{repo},
  // so no extra prefix is needed.
  const pathSegments = remoteUrl.pathname.split("/").filter(Boolean);
  const orgPrefix = remoteUrl.hostname === "dev.azure.com" && pathSegments.length > 0
    ? `/${pathSegments[0]}`
    : "";

  const url = new URL(
    `${remoteUrl.origin}${orgPrefix}/${encodeURIComponent(projectName)}/_apis/git/repositories/${encodeURIComponent(wiki.repositoryId)}/Items`
  );
  url.searchParams.set("path", repositoryPath);
  url.searchParams.set("download", "true");
  return url.toString();
}
