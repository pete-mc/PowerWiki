import MarkdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";

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

      if (openingLine !== "::: mermaid") {
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
  return new MarkdownIt({
    breaks: false,
    html: true,
    linkify: true,
    typographer: true
  })
    .use(markdownItAnchor)
    .use(mermaidContainerPlugin);
}
