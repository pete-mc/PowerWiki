import type MarkdownIt from "markdown-it";
import Token from "markdown-it/lib/token.mjs";

export const MENTION_ATTR = "data-powerwiki-mention-id";
export const MENTION_SELECTOR = `[${MENTION_ATTR}]`;

/**
 * Azure DevOps stores an identity mention as `@<identity-guid>` in the Markdown
 * source, and resolves the display name at render time. Left alone the raw tag
 * is what readers see, so this plugin turns each one into a placeholder element
 * the preview enriches with the person's name (see enrichMentions in
 * MarkdownPreview). The stored Markdown is untouched, so mentions still render
 * in the built-in Azure DevOps Wiki.
 */
const MENTION_PATTERN = /@<([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi;

export function adoMentionsPlugin(md: MarkdownIt): void {
  md.core.ruler.after("inline", "ado_mentions", (state) => {
    for (const token of state.tokens) {
      if (token.type !== "inline" || !token.children) {
        continue;
      }

      token.children = replaceMentions(token.children, md.utils.escapeHtml);
    }
  });
}

function replaceMentions(tokens: Token[], escapeHtml: (value: string) => string): Token[] {
  const replaced: Token[] = [];

  for (const token of tokens) {
    if (token.type !== "text") {
      replaced.push(token);
      continue;
    }

    replaced.push(...splitMentions(token, escapeHtml));
  }

  return replaced;
}

function splitMentions(token: Token, escapeHtml: (value: string) => string): Token[] {
  const result: Token[] = [];
  const pattern = new RegExp(MENTION_PATTERN.source, MENTION_PATTERN.flags);
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(token.content)) !== null) {
    if (match.index > cursor) {
      result.push(createTextToken(token.content.slice(cursor, match.index)));
    }

    result.push(createMentionToken(match[1], escapeHtml));
    cursor = match.index + match[0].length;
  }

  if (cursor === 0) {
    return [token];
  }

  if (cursor < token.content.length) {
    result.push(createTextToken(token.content.slice(cursor)));
  }

  return result;
}

function createTextToken(content: string): Token {
  const token = new Token("text", "", 0);
  token.content = content;
  return token;
}

function createMentionToken(id: string, escapeHtml: (value: string) => string): Token {
  const token = new Token("html_inline", "", 0);
  const safeId = escapeHtml(id);
  token.content =
    `<span class="powerwiki-mention" ${MENTION_ATTR}="${safeId}" title="${safeId}">@…</span>`;

  return token;
}
