/**
 * Guards the preview's attachment-image enricher against a sanitizer bypass.
 *
 * The enricher reads a resolved URL back out of a `data-*` attribute in the
 * rendered DOM and assigns it to `img.src`. That read happens *after*
 * `sanitizeRenderedHtml`, and DOMPurify passes `data-*` attributes through
 * untouched — so unlike a real `src`, the value never had its URI scheme
 * validated, and a page author can plant one with raw HTML in their Markdown.
 *
 * Legitimate values are always produced by the app: an authenticated Git Items
 * URL on the Azure DevOps host, or an object URL the preview created itself.
 * A narrow scheme allowlist therefore costs nothing and closes the gap.
 *
 * `<img src="javascript:…">` does not execute in current browsers, so this is
 * hardening rather than a fix for a live hole — but the value reaches a URL
 * sink without the check the sanitizer would have applied, and the same
 * read-then-assign shape would be exploitable at a sink where the scheme does
 * run.
 */
const SAFE_IMAGE_SCHEMES = new Set(["http:", "https:", "blob:"]);

/**
 * True when `url` resolves to something an <img> may safely load. Relative
 * URLs are resolved against `base` first, so they inherit the page's scheme
 * and keep working.
 */
export function isSafeImageUrl(url: string, base?: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const resolved = new URL(trimmed, base ?? document.baseURI);
    return SAFE_IMAGE_SCHEMES.has(resolved.protocol);
  } catch {
    // A value that will not parse as a URL is not one we should hand to `src`.
    return false;
  }
}
