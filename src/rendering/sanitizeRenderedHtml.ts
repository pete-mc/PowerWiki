import DOMPurify from "dompurify";

export function sanitizeRenderedHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["class", "target"],
    USE_PROFILES: {
      html: true
    }
  });
}

export function sanitizeRenderedSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: {
      svg: true,
      svgFilters: true
    }
  });
}
