import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

/**
 * Adds the Azure DevOps Wiki image-size syntax:
 *
 *   ![Image alt text](./image.png =500x250)   width and height
 *   ![Image alt text](./image.png =500x)      width only
 *   ![Image alt text](./image.png =x250)      height only
 *
 * Plain CommonMark expects an optional quoted *title* after the destination, so
 * markdown-it rejects the `=500x250` suffix outright and the whole image falls
 * back to literal text — the author sees their Markdown, not their picture.
 *
 * This runs as an inline rule ahead of the built-in `image` rule and bails out
 * (returning false, so the built-in rule takes over) on anything that isn't the
 * sized form. Parsing uses markdown-it's own link helpers rather than a copied
 * parser, so bracket nesting, escapes and `<...>` destinations keep working and
 * a markdown-it upgrade doesn't leave a stale fork behind.
 *
 * The emitted token is a standard `image` token, so the default renderer, the
 * sanitizer, and the preview's attachment-image resolution all treat it like any
 * other image — the size just rides along as width/height attributes.
 */

// Sticky: anchored at the parser's current position. At least one dimension has
// to be present; the "x" separator is always required (as in the ADO docs).
const SIZE_AT_POSITION = /=(\d*)x(\d*)/y;

const BANG = 0x21;
const OPEN_BRACKET = 0x5b;
const OPEN_PAREN = 0x28;
const CLOSE_PAREN = 0x29;

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c;
}

function skipSpaces(src: string, start: number, max: number): number {
  let pos = start;
  while (pos < max && isSpace(src.charCodeAt(pos))) {
    pos += 1;
  }
  return pos;
}

export function adoImageSizePlugin(md: MarkdownIt): void {
  md.inline.ruler.before("image", "ado_image_size", (state, silent) => {
    if (
      state.src.charCodeAt(state.pos) !== BANG ||
      state.src.charCodeAt(state.pos + 1) !== OPEN_BRACKET
    ) {
      return false;
    }

    const labelStart = state.pos + 2;
    const labelEnd = md.helpers.parseLinkLabel(state, state.pos + 1, false);
    if (labelEnd < 0) {
      return false;
    }

    let pos = labelEnd + 1;
    if (state.src.charCodeAt(pos) !== OPEN_PAREN) {
      // A reference-style image; it has no size suffix to handle.
      return false;
    }
    pos = skipSpaces(state.src, pos + 1, state.posMax);

    const destination = md.helpers.parseLinkDestination(state.src, pos, state.posMax);
    if (!destination.ok) {
      return false;
    }
    const href = md.normalizeLink(destination.str);
    if (!md.validateLink(href)) {
      return false;
    }
    pos = destination.pos;

    // The size must be preceded by whitespace, per the Azure DevOps syntax.
    const beforeSpaces = pos;
    pos = skipSpaces(state.src, pos, state.posMax);
    if (pos === beforeSpaces) {
      return false;
    }

    SIZE_AT_POSITION.lastIndex = pos;
    const size = SIZE_AT_POSITION.exec(state.src);
    if (!size) {
      return false;
    }
    const [, width, height] = size;
    if (!width && !height) {
      return false;
    }
    pos = skipSpaces(state.src, SIZE_AT_POSITION.lastIndex, state.posMax);

    if (state.src.charCodeAt(pos) !== CLOSE_PAREN) {
      return false;
    }

    if (!silent) {
      const content = state.src.slice(labelStart, labelEnd);
      const children: Token[] = [];
      md.inline.parse(content, md, state.env, children);

      const token = state.push("image", "img", 0);
      // "alt" is filled in by the default image renderer from the children, but
      // the attribute has to exist for it to find the slot.
      token.attrs = [
        ["src", href],
        ["alt", ""],
      ];
      if (width) {
        token.attrs.push(["width", width]);
      }
      if (height) {
        token.attrs.push(["height", height]);
      }
      token.children = children;
      token.content = content;
    }

    state.pos = pos + 1;
    return true;
  });
}
