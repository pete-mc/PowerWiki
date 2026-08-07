/**
 * Naming and reference rules for draw.io diagrams stored as wiki attachments.
 *
 * A diagram is stored as `<slug>-<revision>.drawio.png`: a normal PNG with the
 * draw.io source XML embedded in its metadata, so the same file both renders
 * everywhere (including the built-in Azure DevOps Wiki and Word/PDF exports) and
 * reopens as a fully editable diagram.
 *
 * The revision suffix exists because the wiki attachments API is create-only —
 * a second PUT to an existing name fails with "already exists. Please specify a
 * new path", and there is no update or delete endpoint. Saving an edit therefore
 * writes a new file and rewrites the references that pointed at the old one,
 * which is also what keeps a diagram shared by several pages in sync.
 */

const REVISION_LENGTH = 12;

/** `<slug>-<12 base36 chars>.drawio.png`, the form saveDiagram writes. */
const DIAGRAM_NAME = new RegExp(`^(.*)-([a-z0-9]{${REVISION_LENGTH}})\\.drawio\\.png$`, "i");

export const DRAWIO_SUFFIX = ".drawio.png";

/** True when a path points at a stored draw.io diagram. */
export function isDrawioPath(path: string): boolean {
  return path.toLowerCase().endsWith(DRAWIO_SUFFIX);
}

/**
 * A fixed-width, collision-resistant revision marker. Fixed width is what lets
 * `slugOf` strip it back off again without eating part of the author's title.
 */
function revision(): string {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2);
  return `${time}${random}`.slice(0, REVISION_LENGTH).padEnd(REVISION_LENGTH, "0");
}

/** Turns a diagram title into a filesystem-safe slug. */
export function slugify(title: string): string {
  const slug = title
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
  return slug || "diagram";
}

/**
 * The stable part of a diagram's name — the slug without its revision suffix.
 * Falls back to the whole base name for files that don't carry one (e.g. a
 * `.drawio.png` uploaded by hand or produced by another tool).
 */
export function slugOf(path: string): string {
  const name = path.split("/").filter(Boolean).at(-1) ?? path;
  const match = DIAGRAM_NAME.exec(name);
  if (match) {
    return match[1];
  }
  return slugify(name.replace(/\.drawio\.png$/i, ""));
}

/** The attachment name for a brand new diagram with the given title. */
export function newDiagramName(title: string): string {
  return `${slugify(title)}-${revision()}${DRAWIO_SUFFIX}`;
}

/** The attachment name for the next revision of an existing diagram. */
export function nextDiagramName(currentPath: string): string {
  return `${slugOf(currentPath)}-${revision()}${DRAWIO_SUFFIX}`;
}

/** A readable label for a diagram, used as image alt text. */
export function diagramTitle(path: string): string {
  return slugOf(path).replace(/[-_]+/g, " ").trim() || "Diagram";
}

/** The Markdown image reference for a stored diagram. */
export function diagramMarkdown(path: string, title?: string): string {
  const label = (title ?? diagramTitle(path)).replace(/[[\]]/g, "");
  return `![${label}](${path.replace(/ /g, "%20")})`;
}

/** Strips the `data:image/png;base64,` prefix from an exported diagram. */
export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/**
 * Counts references to an attachment path in a page's Markdown. Matches the raw
 * and percent-encoded spellings, mirroring how rewriteWikiLinks rewrites them.
 */
export function countDiagramReferences(markdown: string, path: string): number {
  let count = 0;
  const destination = /\]\(([^()\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of markdown.matchAll(destination)) {
    if (safeDecode(match[1]) === path) {
      count += 1;
    }
  }
  return count;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
