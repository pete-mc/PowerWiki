import type { MarkdownIt, StateBlock, StateInline } from "markdown-it";

/**
 * Tokenizes TeX math written as `$inline$` and `$$display$$` into placeholder
 * elements carrying the raw TeX. KaTeX is not invoked here — the preview renders
 * the placeholders in a DOM post-process (see mathRender.ts) so KaTeX loads as
 * its own async chunk. In the built-in Azure DevOps Wiki the same `$...$` syntax
 * still renders as math, so content stays portable.
 *
 * The inline/block tokenizers follow the well-worn markdown-it-katex approach.
 */
export const MATH_ATTR = "data-powerwiki-math";

function isValidDelim(state: StateInline, pos: number): { canClose: boolean; canOpen: boolean } {
  const max = state.posMax;
  const prevChar = pos > 0 ? state.src.charCodeAt(pos - 1) : -1;
  const nextChar = pos + 1 <= max ? state.src.charCodeAt(pos + 1) : -1;

  const canOpen = !(nextChar === 0x20 || nextChar === 0x09);
  const canClose = !(prevChar === 0x20 || prevChar === 0x09 || (nextChar >= 0x30 && nextChar <= 0x39));
  return { canClose, canOpen };
}

function mathInline(state: StateInline, silent: boolean): boolean {
  if (state.src[state.pos] !== "$") {
    return false;
  }

  let res = isValidDelim(state, state.pos);
  if (!res.canOpen) {
    if (!silent) {
      state.pending += "$";
    }
    state.pos += 1;
    return true;
  }

  const start = state.pos + 1;
  let match = start;
  let pos: number;
  while ((match = state.src.indexOf("$", match)) !== -1) {
    pos = match - 1;
    while (state.src[pos] === "\\") {
      pos -= 1;
    }
    if ((match - pos) % 2 === 1) {
      break;
    }
    match += 1;
  }

  if (match === -1) {
    if (!silent) {
      state.pending += "$";
    }
    state.pos = start;
    return true;
  }

  if (match - start === 0) {
    if (!silent) {
      state.pending += "$$";
    }
    state.pos = start + 1;
    return true;
  }

  res = isValidDelim(state, match);
  if (!res.canClose) {
    if (!silent) {
      state.pending += "$";
    }
    state.pos = start;
    return true;
  }

  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.markup = "$";
    token.content = state.src.slice(start, match);
  }
  state.pos = match + 1;
  return true;
}

function mathBlock(state: StateBlock, start: number, end: number, silent: boolean): boolean {
  let pos = state.bMarks[start] + state.tShift[start];
  let max = state.eMarks[start];
  if (pos + 2 > max || state.src.slice(pos, pos + 2) !== "$$") {
    return false;
  }

  pos += 2;
  let firstLine = state.src.slice(pos, max);
  if (silent) {
    return true;
  }

  let found = false;
  let lastLine = "";
  if (firstLine.trim().slice(-2) === "$$") {
    firstLine = firstLine.trim().slice(0, -2);
    found = true;
  }

  let next = start;
  while (!found) {
    next += 1;
    if (next >= end) {
      break;
    }
    pos = state.bMarks[next] + state.tShift[next];
    max = state.eMarks[next];
    if (pos < max && state.tShift[next] < state.blkIndent) {
      break;
    }
    if (state.src.slice(pos, max).trim().slice(-2) === "$$") {
      const lastPos = state.src.slice(0, max).lastIndexOf("$$");
      lastLine = state.src.slice(pos, lastPos);
      found = true;
    }
  }

  state.line = next + 1;
  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content =
    (firstLine.trim() ? `${firstLine}\n` : "") +
    state.getLines(start + 1, next, state.tShift[start], true) +
    (lastLine.trim() ? lastLine : "");
  token.map = [start, state.line];
  token.markup = "$$";
  return true;
}

export function mathPlugin(md: MarkdownIt): void {
  md.inline.ruler.after("escape", "math_inline", mathInline);
  md.block.ruler.after("blockquote", "math_block", mathBlock, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });

  md.renderer.rules.math_inline = (tokens, idx) =>
    `<span class="powerwiki-math" ${MATH_ATTR}="inline">${md.utils.escapeHtml(tokens[idx].content)}</span>`;

  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="powerwiki-math" ${MATH_ATTR}="display">${md.utils.escapeHtml(tokens[idx].content)}</div>\n`;
}
