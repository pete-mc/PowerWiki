// Reading a customer's own Word template so an export can adopt it.
//
// Two mechanisms, and which one applies is decided by what the template
// actually contains rather than by anything the user has to choose:
//
//   `{{PowerWikiContent}}` present — the rendered pages are patched into that
//     spot inside the real .docx, so the cover page, headers, footers, page
//     setup, and styles around it all survive.
//   absent — the template's own styles.xml is applied to a document we
//     generate, so headings and body text still take its fonts and colours.
//     Layout cannot come across this way, which is what the placeholder buys.
//
// The fallback matters more than it looks. `patchDocument` does *not* fail when
// the placeholder is missing: it returns the template with the content silently
// dropped, so a plain corporate template would export a cover page and nothing
// else. Detecting the placeholder here is what turns that into a lesser result
// instead of a lost document.
//
// jszip is already in the bundle — docx depends on it to pack documents — so
// reading the archive costs no meaningful weight.

import JSZip from "jszip";

/** Marks the spot in a template where the wiki content belongs. */
export const TEMPLATE_PLACEHOLDER = "PowerWikiContent";

/** What an author types into the template document. */
export const TEMPLATE_PLACEHOLDER_TOKEN = `{{${TEMPLATE_PLACEHOLDER}}}`;

/**
 * Where a wiki keeps its house template, so exports from a project match each
 * other instead of depending on who ran them. Stored as a normal attachment:
 * it stays in the wiki's own Git repository like every other asset, and a wiki
 * without one simply has no file here.
 */
export const PROJECT_TEMPLATE_WIKI_PATH = "/.attachments/powerwiki-template.docx";

/** A template that could not be read, with a message worth showing a user. */
export class WordTemplateError extends Error {}

export interface WordTemplate {
  /** The original file, handed to `patchDocument` unchanged. */
  readonly data: ArrayBuffer;
  /** Whether the content placeholder was found; decides which mechanism runs. */
  readonly hasPlaceholder: boolean;
  /** The template's styles.xml, used when there is no placeholder. */
  readonly stylesXml?: string;
}

/**
 * Inspects a .docx/.dotx and reports how it can be applied. Throws
 * `WordTemplateError` for anything that is not a Word document, so the dialog
 * can say so rather than failing later inside the export.
 */
export async function readWordTemplate(data: ArrayBuffer): Promise<WordTemplate> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new WordTemplateError("That file is not a Word document. Choose a .docx or .dotx file.");
  }

  // Every Word document has word/document.xml; a renamed PDF or an .doc will
  // load as a zip in some cases but never has one.
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (documentXml === undefined) {
    throw new WordTemplateError("That file is not a Word document. Choose a .docx or .dotx file.");
  }

  return {
    data,
    hasPlaceholder: containsPlaceholder(documentXml),
    stylesXml: await zip.file("word/styles.xml")?.async("string"),
  };
}

/**
 * Word splits a typed token across runs whenever formatting, a language change,
 * or a spell-check boundary falls inside it, so `{{PowerWikiContent}}` routinely
 * reaches document.xml as several `<w:t>` fragments. Searching the raw XML would
 * miss exactly those templates, so search the text with the markup removed —
 * which is also how docx's own patcher finds it.
 */
function containsPlaceholder(documentXml: string): boolean {
  return documentXml.replace(/<[^>]*>/g, "").includes(TEMPLATE_PLACEHOLDER_TOKEN);
}
