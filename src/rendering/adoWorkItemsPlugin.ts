import type MarkdownIt from "markdown-it";
import Token from "markdown-it/lib/token.mjs";

export const QUERY_TABLE_ATTR = "data-powerwiki-query-id";
export const QUERY_TABLE_SELECTOR = `[${QUERY_TABLE_ATTR}]`;
export const WORK_ITEM_ATTR = "data-powerwiki-work-item-id";
export const WORK_ITEM_SELECTOR = `[${WORK_ITEM_ATTR}]`;

/**
 * Adds Azure DevOps work item conveniences while keeping the stored Markdown
 * portable:
 *
 *   ::: query-table 9a0fb95d-55b7-4fd3-af6b-30b8921ada61 :::
 *   #1234
 */
export function adoWorkItemsPlugin(md: MarkdownIt): void {
  md.block.ruler.before("fence", "query_table", (state, startLine, endLine, silent) => {
    if (state.tShift[startLine] < 0) {
      return false;
    }

    const lineStart = state.bMarks[startLine] + state.tShift[startLine];
    const lineEnd = state.eMarks[startLine];
    const openingLine = state.src.slice(lineStart, lineEnd).trim();
    const inlineMatch = /^:::\s*query-table\s+([^\s:]+)\s*:::\s*$/i.exec(openingLine);
    const blockMatch = /^:::\s*query-table\s+([^\s:]+)\s*$/i.exec(openingLine);

    if (!inlineMatch && !blockMatch) {
      return false;
    }

    if (silent) {
      return true;
    }

    let nextLine = startLine + 1;
    if (blockMatch) {
      while (nextLine < endLine) {
        const closeStart = state.bMarks[nextLine] + state.tShift[nextLine];
        const closeEnd = state.eMarks[nextLine];
        if (state.src.slice(closeStart, closeEnd).trim() === ":::") {
          nextLine += 1;
          break;
        }
        nextLine += 1;
      }
    }

    const queryId = inlineMatch?.[1] ?? blockMatch?.[1] ?? "";
    const token = state.push("html_block", "", 0);
    token.content =
      `<div class="powerwiki-query-table" ${QUERY_TABLE_ATTR}="${md.utils.escapeHtml(queryId)}">` +
      "Loading query." +
      "</div>\n";
    token.map = [startLine, nextLine];

    state.line = nextLine;
    return true;
  });

  md.core.ruler.after("inline", "work_item_badges", (state) => {
    for (const token of state.tokens) {
      if (token.type !== "inline" || !token.children) {
        continue;
      }

      token.children = replaceWorkItemReferences(token.children);
    }
  });
}

function replaceWorkItemReferences(tokens: Token[]): Token[] {
  const replaced: Token[] = [];
  let linkDepth = 0;

  for (const token of tokens) {
    if (token.type === "link_open") {
      linkDepth += 1;
      replaced.push(token);
      continue;
    }

    if (token.type === "link_close") {
      linkDepth = Math.max(0, linkDepth - 1);
      replaced.push(token);
      continue;
    }

    if (token.type !== "text" || linkDepth > 0) {
      replaced.push(token);
      continue;
    }

    replaced.push(...splitWorkItemReferences(token));
  }

  return replaced;
}

function splitWorkItemReferences(token: Token): Token[] {
  const result: Token[] = [];
  const pattern = /(^|[^\w/])#([1-9]\d{0,9})(?=\b)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(token.content)) !== null) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const id = match[2] ?? "";
    const badgeStart = match.index + prefix.length;

    if (badgeStart > cursor) {
      result.push(createTextToken(token.content.slice(cursor, badgeStart)));
    }

    result.push(createWorkItemBadge(id));
    cursor = match.index + fullMatch.length;
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

function createWorkItemBadge(id: string): Token {
  const wrapper = new Token("html_inline", "", 0);
  wrapper.content =
    `<a href="#" class="powerwiki-work-item-badge" ${WORK_ITEM_ATTR}="${id}" title="Open work item ${id}">#${id}</a>`;

  return wrapper;
}
