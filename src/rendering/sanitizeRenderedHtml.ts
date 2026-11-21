import DOMPurify from "dompurify";

export function sanitizeRenderedHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    // These are PowerWiki's internal hand-off attributes. They are added only
    // after sanitization when a wiki-relative image has been resolved to a
    // host-generated Git Items URL. Raw Markdown must not be able to plant an
    // authenticated-fetch destination in the rendered DOM.
    FORBID_ATTR: ["data-powerwiki-image", "data-powerwiki-image-src"],
    // "id" is needed so heading anchors (from markdown-it-anchor) survive; the
    // [[_TOC_]] links target them via "#id". "class"/"target" keep mermaid
    // <pre class="mermaid"> and external-link targets intact.
    ADD_ATTR: [
      "class",
      "data-powerwiki-line",
      "data-powerwiki-math",
      "data-powerwiki-mention-id",
      "data-powerwiki-placeholder",
      "data-powerwiki-query-id",
      "data-powerwiki-work-item-id",
      "id",
      "target",
      "title"
    ],
    USE_PROFILES: {
      html: true
    }
  });
}
