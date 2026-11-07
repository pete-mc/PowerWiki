/** Converts an Azure DevOps attachment URL path to its wiki-relative form. */
export function wikiAttachmentPath(path: string): string {
  const folder = path.lastIndexOf("/.attachments/");
  return folder > 0 ? path.slice(folder) : path;
}
