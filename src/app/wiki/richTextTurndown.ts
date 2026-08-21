// The Markdown-out half of the rich text editor.
//
// Extracted from the component because it is pure - no props, no refs, no
// hooks - and because what it does is the part with teeth: every rule here
// decides what gets *written back to the wiki file* when someone saves from
// WYSIWYG mode. A rule that silently drops an attribute turns a save into data
// loss, which is exactly the kind of thing that should be covered by tests
// rather than noticed by a reader.

import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

import { MENTION_ATTR } from "../../rendering/adoMentionsPlugin";
import { mentionMarkdown } from "./mentionTrigger";

/** Builds the Turndown service the rich text editor converts its DOM with. */
export function createRichTextTurndown(): TurndownService {
  const service = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "_",
    headingStyle: "atx",
    hr: "---",
    linkStyle: "inlined"
  });

  // GFM support so HTML tables, strikethrough, and task lists round-trip to
  // Markdown table/`~~`/`- [ ]` syntax instead of being flattened to text.
  service.use(gfm);

  // Keep line-break intentions when users hit Enter+Shift in rich text mode.
  service.addRule("lineBreak", {
    filter: "br",
    replacement: () => "  \n"
  });

  // Emit the portable wiki path (stashed in data-wiki-src when an image was
  // resolved for display) instead of the resolved CDN URL, so stored Markdown
  // stays readable in the built-in Azure DevOps Wiki.
  service.addRule("wikiImage", {
    filter: "img",
    replacement: (_content, node) => {
      const element = node as HTMLElement;
      const src = element.getAttribute("data-wiki-src") || element.getAttribute("src") || "";
      if (!src) {
        return "";
      }
      const alt = element.getAttribute("alt") ?? "";
      const url = src.replace(/ /g, "%20");
      // Preserve an authored `=WxH` size across the round trip.
      const width = element.getAttribute("width") ?? "";
      const height = element.getAttribute("height") ?? "";
      const size = width || height ? ` =${width}x${height}` : "";
      return `![${alt}](${url}${size})`;
    }
  });

  // A mention chip carries the identity in a data attribute and shows the
  // person's name. Without this rule Turndown would write the *name* back to
  // the file and the mention would be gone - the visible text is a display
  // convenience, the attribute is the data.
  service.addRule("wikiMention", {
    filter: (node) => node.nodeName === "SPAN" && node.hasAttribute(MENTION_ATTR),
    replacement: (_content, node) => mentionMarkdown((node as HTMLElement).getAttribute(MENTION_ATTR) ?? "")
  });

return service;
}
