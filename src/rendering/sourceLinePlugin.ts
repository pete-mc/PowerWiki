// Stamps rendered blocks with the source line they came from.
//
// This is what lets the split view line the preview up with the editor: the
// editor knows which line is at the top of its viewport, and the preview needs
// to answer "where is that line on screen?". markdown-it already computes the
// answer - every block token carries `map` - so the whole job is copying it
// onto the element.
//
// Only *top-level* block tokens are stamped. Stamping nested ones - list
// items, table cells - multiplies the anchors for no gain, because the mapping
// interpolates between them anyway, and it puts an attribute on every cell of
// every table. One anchor per top-level block is enough to keep a list or a
// table honest, since their rows are of similar height.

import type { MarkdownIt } from "markdown-it";

/** Carries the 1-based source line a rendered block starts on. */
export const SOURCE_LINE_ATTR = "data-powerwiki-line";

export function sourceLinePlugin(md: MarkdownIt): void {
  md.core.ruler.push("powerwiki_source_lines", (state) => {
    for (const token of state.tokens) {
      // `map` is null on closing tokens, and an inline token describes a range
      // its parent block already covers.
      if (token.map && token.nesting >= 0 && token.level === 0 && token.type !== "inline") {
        token.attrSet(SOURCE_LINE_ATTR, String(token.map[0] + 1));
      }
    }
    return true;
  });
}
