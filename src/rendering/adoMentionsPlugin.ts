import type MarkdownIt from "markdown-it";

export const MENTION_ATTR = "data-powerwiki-mention-id";
export const MENTION_SELECTOR = `[${MENTION_ATTR}]`;

/**
 * Azure DevOps stores an identity mention as `@<identity-guid>` in the Markdown
 * source, and resolves the display name at render time. Left alone the raw tag
 * is what readers see, so this plugin turns each one into a placeholder element
 * the preview enriches with the person's name (see enrichMentions in
 * MarkdownPreview). The stored Markdown is untouched, so mentions still render
 * in the built-in Azure DevOps Wiki.
 *
 * This has to be an *inline* rule ahead of `html_inline`, not a core rule over
 * the parsed text tokens. Roughly half of all GUIDs start with a–f, and with
 * `html: true` markdown-it happily reads `<a502d9c7-0cbd-45de-...>` as an HTML
 * open tag (a letter followed by alphanumerics and hyphens is a valid tag name),
 * so by the time a core rule ran the GUID was already an html_inline token that
 * the sanitizer then dropped — leaving a bare "@" on the page.
 *
 * The sticky flag anchors the match at the parser's current position.
 */
const MENTION_AT_POSITION =
  /@<([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/iy;

const AT_SIGN = 0x40;

export function adoMentionsPlugin(md: MarkdownIt): void {
  md.inline.ruler.before("html_inline", "ado_mention", (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== AT_SIGN) {
      return false;
    }

    MENTION_AT_POSITION.lastIndex = state.pos;
    const match = MENTION_AT_POSITION.exec(state.src);
    if (!match) {
      return false;
    }

    if (!silent) {
      // push() flushes any pending text first, so surrounding prose is kept.
      const token = state.push("html_inline", "", 0);
      const safeId = md.utils.escapeHtml(match[1]);
      token.content =
        `<span class="powerwiki-mention" ${MENTION_ATTR}="${safeId}" title="${safeId}">@…</span>`;
    }

    state.pos += match[0].length;
    return true;
  });
}
