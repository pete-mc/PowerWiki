import type { MarkdownIt, Token } from "markdown-it";

/**
 * Renders GitHub-style callouts / admonitions written as a blockquote whose
 * first line is a `[!TYPE]` marker, matching the built-in Azure DevOps Wiki:
 *
 *   > [!NOTE]
 *   > Useful information users should know.
 *
 * The blockquote gains `powerwiki-callout powerwiki-callout-<type>` classes and
 * a title line; the marker is stripped from the body. In the built-in wiki the
 * same Markdown still reads as an ordinary blockquote, so content stays portable.
 */
const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;

const LABELS: Record<string, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

export function calloutsPlugin(md: MarkdownIt): void {
  md.core.ruler.after("block", "powerwiki_callouts", (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "blockquote_open") {
        continue;
      }

      const paragraphOpen = tokens[i + 1];
      const inline = tokens[i + 2];
      if (!paragraphOpen || paragraphOpen.type !== "paragraph_open" || !inline || inline.type !== "inline") {
        continue;
      }

      const match = ALERT_MARKER.exec(inline.content);
      if (!match) {
        continue;
      }

      const type = match[1].toLowerCase();
      tokens[i].attrJoin("class", `powerwiki-callout powerwiki-callout-${type}`);
      stripMarker(inline);

      const title = new state.Token("html_block", "", 0);
      title.content = `<p class="powerwiki-callout-title">${LABELS[type]}</p>\n`;
      tokens.splice(i + 1, 0, title);

      // Drop the first paragraph if the marker was alone on its line, so the
      // callout doesn't start with an empty <p>.
      const emptied = tokens[i + 3];
      if (emptied && emptied.type === "inline" && emptied.content.trim() === "" && (emptied.children?.length ?? 0) === 0) {
        tokens.splice(i + 2, 3);
      }
    }
  });
}

function stripMarker(inline: Token): void {
  inline.content = inline.content.replace(ALERT_MARKER, "").replace(/^[ \t]*\r?\n?/, "");

  const children = inline.children;
  const first = children?.[0];
  if (!children || !first || first.type !== "text") {
    return;
  }

  const stripped = first.content.replace(ALERT_MARKER, "").replace(/^[ \t]+/, "");
  if (stripped !== "") {
    first.content = stripped;
    return;
  }

  children.shift();
  const next = children[0];
  if (next && (next.type === "softbreak" || next.type === "hardbreak")) {
    children.shift();
  }
}
