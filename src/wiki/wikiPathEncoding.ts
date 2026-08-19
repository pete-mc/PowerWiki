// Azure DevOps wiki page path <-> file name on disk.
//
// The published-wiki convention is not a detail we can approximate: get it
// wrong and every link, every attachment reference, and every `.order` entry
// points at a file that isn't there. In the hub the pages API hides this; off a
// clone we own it.
//
// The rules:
//   * a page's Markdown lives at `<name>.md`; its children live in `<name>/`
//   * a space in a page title is stored as `-`
//   * a character that cannot appear (or would be ambiguous) in a file name is
//     percent-encoded — including a literal `-`, as `%2D`, which is what keeps
//     "Well-known" distinct from "Well known"
//
// Decode order matters and is the classic way to get this wrong: `%2D` contains
// no `-`, so replacing `%XX` first and hyphens second is safe, while the reverse
// turns every escaped hyphen into a space.

/**
 * Characters Azure DevOps percent-encodes in a wiki file name.
 *
 * `-` is in the list because the encoding uses it for spaces; the rest are
 * either illegal on Windows or reserved by the wiki's own URL handling.
 */
const ENCODED_CHARACTERS = new Map<string, string>([
  ["-", "%2D"],
  [":", "%3A"],
  ["<", "%3C"],
  [">", "%3E"],
  ["*", "%2A"],
  ["?", "%3F"],
  ["|", "%7C"],
  ['"', "%22"],
  ["\\", "%5C"],
  ["/", "%2F"]
]);

const PERCENT_ESCAPE = /%[0-9a-f]{2}/gi;

/** One page-name segment (no slashes) to the file-name stem stored on disk. */
export function pageSegmentToFileSegment(segment: string): string {
  let encoded = "";
  for (const character of segment) {
    encoded += ENCODED_CHARACTERS.get(character) ?? character;
  }

  return encoded.replace(/ /g, "-");
}

/** The inverse: a file-name stem back to the page-name segment it represents. */
export function fileSegmentToPageSegment(segment: string): string {
  let result = "";
  let cursor = 0;

  PERCENT_ESCAPE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PERCENT_ESCAPE.exec(segment)) !== null) {
    result += segment.slice(cursor, match.index).replace(/-/g, " ");
    result += decodeEscape(match[0]);
    cursor = match.index + match[0].length;
  }

  result += segment.slice(cursor).replace(/-/g, " ");
  return result;
}

function decodeEscape(escape: string): string {
  const code = Number.parseInt(escape.slice(1), 16);
  // An escape we don't recognise is content, not an instruction: a page whose
  // title genuinely contains "%41" must not silently become "A".
  return ENCODED_CHARACTERS.has(String.fromCharCode(code)) ? String.fromCharCode(code) : escape;
}

/**
 * Wiki page path (`/Getting Started/Set-up`) to its path relative to the wiki
 * root, without the `.md` extension (`Getting-Started/Set%2Dup`).
 */
export function pagePathToRelativePath(pagePath: string): string {
  return splitPagePath(pagePath).map(pageSegmentToFileSegment).join("/");
}

/** Wiki-root-relative file path (with or without `.md`) back to a page path. */
export function relativePathToPagePath(relativePath: string): string {
  const withoutExtension = relativePath.replace(/\.md$/i, "");
  const segments = withoutExtension
    .split("/")
    .filter(Boolean)
    .map(fileSegmentToPageSegment);

  return segments.length > 0 ? `/${segments.join("/")}` : "/";
}

/** Splits a page path into its segments, tolerating a missing leading slash. */
export function splitPagePath(pagePath: string): string[] {
  return pagePath.split("/").filter(Boolean);
}

/** Normalises a page path to a leading slash and no trailing slash. */
export function normalizePagePath(pagePath: string): string {
  const segments = splitPagePath(pagePath);
  return segments.length > 0 ? `/${segments.join("/")}` : "/";
}

/** The page path of a page's parent (`/` for a top-level page). */
export function parentPagePath(pagePath: string): string {
  const segments = splitPagePath(pagePath);
  return segments.length > 1 ? `/${segments.slice(0, -1).join("/")}` : "/";
}

/** The last segment of a page path, as a display title. */
export function pageTitle(pagePath: string): string {
  return splitPagePath(pagePath).at(-1) ?? "Home";
}
