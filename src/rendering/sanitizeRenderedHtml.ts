import DOMPurify from "dompurify";

export function sanitizeRenderedHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    // "id" is needed so heading anchors (from markdown-it-anchor) survive; the
    // [[_TOC_]] links target them via "#id". "class"/"target" keep mermaid
    // <pre class="mermaid"> and external-link targets intact.
    ADD_ATTR: [
      "class",
      "data-powerwiki-math",
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
