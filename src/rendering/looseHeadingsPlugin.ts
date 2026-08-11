import type { MarkdownIt } from "markdown-it";

const HASH = 0x23; // #

/**
 * Renders ATX headings that omit the space after the hashes:
 *
 *   #Overview
 *   ###Release notes
 *
 * CommonMark (and therefore markdown-it) requires `# Overview`, so those lines
 * otherwise fall through to a paragraph and the hashes show up as literal text.
 *
 * A hash run followed immediately by a digit is deliberately left alone: `#1234`
 * is an Azure DevOps work-item reference (see `adoWorkItemsPlugin`), and that
 * shorthand wins over the heading reading. Everything else — letters, symbols,
 * emphasis markers — becomes a heading of the matching level.
 */
export function looseHeadingsPlugin(md: MarkdownIt): void {
  md.block.ruler.before(
    "heading",
    "powerwiki_loose_heading",
    (state, startLine, _endLine, silent) => {
      // Indented four spaces or more is an indented code block, not a heading.
      if (state.sCount[startLine] - state.blkIndent >= 4) {
        return false;
      }

      let pos = state.bMarks[startLine] + state.tShift[startLine];
      let max = state.eMarks[startLine];

      if (state.src.charCodeAt(pos) !== HASH) {
        return false;
      }

      let level = 0;
      while (pos < max && state.src.charCodeAt(pos) === HASH) {
        level += 1;
        pos += 1;
      }

      // `#######Foo` is not a heading in any dialect; an empty hash run (`##`)
      // and the spaced form are both handled by the built-in heading rule.
      if (level > 6 || pos >= max || md.utils.isSpace(state.src.charCodeAt(pos))) {
        return false;
      }

      if (isDigit(state.src.charCodeAt(pos))) {
        return false;
      }

      if (silent) {
        return true;
      }

      // Cut a closing sequence like `#Title ###`, matching the built-in rule.
      max = state.skipSpacesBack(max, pos);
      const beforeClosing = state.skipCharsBack(max, HASH, pos);
      if (beforeClosing > pos && md.utils.isSpace(state.src.charCodeAt(beforeClosing - 1))) {
        max = beforeClosing;
      }

      state.line = startLine + 1;

      const markup = "#".repeat(level);
      const open = state.push("heading_open", `h${level}`, 1);
      open.markup = markup;
      open.map = [startLine, state.line];

      const inline = state.push("inline", "", 0);
      inline.content = state.src.slice(pos, max).trim();
      inline.map = [startLine, state.line];
      inline.children = [];

      const close = state.push("heading_close", `h${level}`, -1);
      close.markup = markup;

      return true;
    },
    // Same alternatives as the built-in heading rule, so a spaceless heading can
    // interrupt a paragraph and works inside blockquotes.
    { alt: ["paragraph", "reference", "blockquote"] }
  );
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}
