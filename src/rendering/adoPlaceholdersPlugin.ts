import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

/**
 * Adds support for the Azure DevOps Wiki placeholder tags:
 *
 *   [[_TOC_]]   – a table of contents built from the page's headings.
 *   [[_TOSP_]]  – a table of subpages (the current page's direct children).
 *
 * The tags are matched case-insensitively and the surrounding underscores are
 * optional, so `[[TOC]]` and `[[_toc_]]` are treated the same as `[[_TOC_]]`.
 * A tag is only recognised when it occupies a line on its own, mirroring how
 * the built-in Azure DevOps Wiki treats these placeholders.
 *
 * The TOC is fully rendered here from the parsed heading tokens. The TOSP tag
 * is emitted as an empty placeholder element which the preview component fills
 * in with the current page's subpages, since subpage data lives in the Azure
 * DevOps data layer rather than in the Markdown source.
 */

const PLACEHOLDER_PATTERN = /^\[\[_?(TOC|TOSP)_?\]\]$/i;

/** Marker attribute the preview looks for to inject the subpage list. */
export const TOSP_PLACEHOLDER_ATTR = "data-powerwiki-placeholder";
export const TOSP_PLACEHOLDER_VALUE = "tosp";

interface TocHeading {
  readonly id: string;
  readonly level: number;
  readonly text: string;
}

function collectHeadings(tokens: readonly Token[]): TocHeading[] {
  const headings: TocHeading[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== "heading_open") {
      continue;
    }

    const level = Number(token.tag.slice(1));
    if (!Number.isFinite(level)) {
      continue;
    }

    const id = token.attrGet("id") ?? "";
    const inline = tokens[i + 1];
    const text = inline && inline.type === "inline" ? inlinePlainText(inline) : "";

    if (id && text) {
      headings.push({ id, level, text });
    }
  }

  return headings;
}

/** Extracts the visible text of a heading, dropping inline markup. */
function inlinePlainText(inline: Token): string {
  if (!inline.children) {
    return inline.content.trim();
  }

  return inline.children
    .filter((child) => child.type === "text" || child.type === "code_inline")
    .map((child) => child.content)
    .join("")
    .trim();
}

function renderTableOfContents(
  tokens: readonly Token[],
  escapeHtml: (value: string) => string
): string {
  const headings = collectHeadings(tokens);
  if (headings.length === 0) {
    return "";
  }

  let html = '<nav class="powerwiki-toc" aria-label="Contents"><ul>';
  let openLists = 1;
  let previousLevel = headings[0].level;

  headings.forEach((heading, index) => {
    if (index > 0) {
      if (heading.level > previousLevel) {
        for (let level = previousLevel; level < heading.level; level++) {
          html += "<ul>";
          openLists++;
        }
      } else {
        html += "</li>";
        for (let level = heading.level; level < previousLevel; level++) {
          html += "</ul></li>";
          openLists--;
        }
      }
    }

    html += `<li><a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a>`;
    previousLevel = heading.level;
  });

  html += "</li>";
  while (openLists > 1) {
    html += "</ul></li>";
    openLists--;
  }
  html += "</ul></nav>\n";

  return html;
}

export function adoPlaceholdersPlugin(md: MarkdownIt): void {
  md.block.ruler.before(
    "paragraph",
    "ado_placeholder",
    (state, startLine, _endLine, silent) => {
      if (state.sCount[startLine] - state.blkIndent >= 4) {
        return false;
      }

      const lineStart = state.bMarks[startLine] + state.tShift[startLine];
      const lineEnd = state.eMarks[startLine];
      const line = state.src.slice(lineStart, lineEnd).trim();

      const match = PLACEHOLDER_PATTERN.exec(line);
      if (!match) {
        return false;
      }

      if (silent) {
        return true;
      }

      const isToc = match[1].toUpperCase() === "TOC";
      const token = state.push(isToc ? "ado_toc" : "ado_tosp", "", 0);
      token.markup = line;
      token.map = [startLine, startLine + 1];
      token.block = true;

      state.line = startLine + 1;
      return true;
    }
  );

  md.renderer.rules.ado_toc = (tokens) =>
    renderTableOfContents(tokens, md.utils.escapeHtml);

  md.renderer.rules.ado_tosp = () =>
    `<div class="powerwiki-subpages" ${TOSP_PLACEHOLDER_ATTR}="${TOSP_PLACEHOLDER_VALUE}"></div>\n`;
}
