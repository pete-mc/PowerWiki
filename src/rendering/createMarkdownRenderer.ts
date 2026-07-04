import MarkdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";

import { adoPlaceholdersPlugin } from "./adoPlaceholdersPlugin";
import { adoWorkItemsPlugin } from "./adoWorkItemsPlugin";
import { calloutsPlugin } from "./calloutsPlugin";

/**
 * Adds support for the Azure DevOps Wiki mermaid container syntax:
 *
 *   ::: mermaid
 *   flowchart LR
 *     A --> B
 *   :::
 *
 * Converts matching blocks to a standard fence token with info "mermaid"
 * so the existing mermaid renderer picks them up as
 * <pre><code class="language-mermaid">.
 */
function mermaidContainerPlugin(md: MarkdownIt): void {
  md.block.ruler.before(
    "fence",
    "mermaid_container",
    (state, startLine, endLine, silent) => {
      if (state.tShift[startLine] < 0) {
        return false;
      }

      const lineStart = state.bMarks[startLine] + state.tShift[startLine];
      const lineEnd = state.eMarks[startLine];
      const openingLine = state.src.slice(lineStart, lineEnd).trim();

      if (!/^:::\s*mermaid\s*$/i.test(openingLine)) {
        return false;
      }

      if (silent) {
        return true;
      }

      let closingLine = startLine + 1;
      while (closingLine < endLine) {
        const closeStart = state.bMarks[closingLine] + state.tShift[closingLine];
        const closeEnd = state.eMarks[closingLine];
        if (state.src.slice(closeStart, closeEnd).trim() === ":::") {
          break;
        }
        closingLine += 1;
      }

      if (closingLine >= endLine) {
        return false;
      }

      const contentParts: string[] = [];
      for (let i = startLine + 1; i < closingLine; i++) {
        contentParts.push(state.src.slice(state.bMarks[i], state.eMarks[i]));
      }

      const token = state.push("fence", "code", 0);
      token.info = "mermaid";
      token.content = contentParts.join("\n") + "\n";
      token.markup = ":::";
      token.map = [startLine, closingLine + 1];

      state.line = closingLine + 1;
      return true;
    }
  );
}

export function createMarkdownRenderer(): MarkdownIt {
  const md = new MarkdownIt({
    breaks: false,
    html: true,
    linkify: true,
    typographer: true,
  })
    .use(markdownItAnchor, {
      permalink: markdownItAnchor.permalink.linkInsideHeader({
        ariaHidden: true,
        class: "powerwiki-heading-anchor",
        placement: "after",
        symbol: "#",
      }),
    })
    .use(mermaidContainerPlugin)
    .use(calloutsPlugin)
    .use(adoWorkItemsPlugin)
    .use(adoPlaceholdersPlugin);

  // Override the fence renderer so that ```mermaid``` (and our ":::mermaid"
  // container plugin which produces the same fence token) emit
  // <pre class="mermaid">ESCAPED_SOURCE</pre>. This is the exact contract
  // mermaid.run() expects — no HTML wrappers, no <code> tag, source as
  // escaped text content. Non-mermaid fences fall through to the default
  // renderer for normal syntax-highlighted code blocks.
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, slf) => {
    const token = tokens[idx];
    const info = token.info.trim().toLowerCase();
    if (isMermaidFence(info)) {
      return `<pre class="mermaid">${md.utils.escapeHtml(token.content)}</pre>\n`;
    }
    return defaultFence
      ? defaultFence(tokens, idx, options, env, slf)
      : slf.renderToken(tokens, idx, options);
  };

  return md;
}

function isMermaidFence(info: string): boolean {
  const language = info.split(/\s+/)[0];
  return language === "mermaid" || language === "{mermaid}";
}
