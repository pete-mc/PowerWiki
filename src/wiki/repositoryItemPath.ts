// Turning a wiki-relative path into a path inside the backing Git repository.
//
// A wiki can be mapped to a subfolder of its repository (`mappedPath`), so a
// page's `/​.attachments/x.png` is not necessarily the repository's
// `/.attachments/x.png`. Both hosts need this join — Azure DevOps to build an
// Items API URL, VS Code to find the file on disk — so it lives here rather
// than in either one.

export function joinRepositoryPath(mappedPath: string | undefined, wikiPath: string): string {
  const normalizedMappedPath = !mappedPath || mappedPath === "/" ? "" : trimSlashes(mappedPath);
  const normalizedWikiPath = trimSlashes(wikiPath);
  const combined = [normalizedMappedPath, normalizedWikiPath].filter(Boolean).join("/");
  return `/${combined}`;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}
