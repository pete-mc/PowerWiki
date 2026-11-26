import type { MarkdownIt } from "markdown-it";
import { footnoteNumbers, inlineFootnotes } from "./footnoteAuthoring";

export const FOOTNOTE_SOURCE_ATTR = "data-powerwiki-footnote-source";
export const FOOTNOTE_PENDING_DEFINITION_ATTR = "data-powerwiki-footnote-definition";

/** Refresh visible numbers without changing the stored Markdown. */
export function updateEditableFootnoteNumbers(editor: HTMLElement, markdown: string): void {
  const references = Array.from(editor.querySelectorAll<HTMLElement>(`.wiki-richtext-footnote-ref[${FOOTNOTE_SOURCE_ATTR}]`));
  const definitions = Array.from(editor.querySelectorAll<HTMLElement>(`.wiki-richtext-footnote[${FOOTNOTE_SOURCE_ATTR}]`));
  definitions.forEach((definition, index) => definition.classList.toggle("wiki-richtext-footnote-first", index === 0));
  if (references.length === 0 && definitions.length === 0) return;
  const numbers = footnoteNumbers(markdown);
  const inline = inlineFootnotes(markdown);
  let inlineIndex = 0;
  const occurrences = new Map<string, number>();
  for (const node of references) {
    let source: string;
    try { source = decodeURIComponent(node.getAttribute(FOOTNOTE_SOURCE_ATTR) ?? ""); }
    catch { continue; }
    const label = /^\[\^([^\]\s]+)\]$/.exec(source)?.[1];
    if (!label) {
      if (source.startsWith("^[")) node.textContent = `[${inline[inlineIndex++]?.number ?? "?"}]`;
      continue;
    }
    const number = numbers.get(label);
    const occurrence = occurrences.get(label) ?? 0;
    occurrences.set(label, occurrence + 1);
    const display = number === undefined ? source : `[${number}${occurrence ? `:${occurrence}` : ""}]`;
    if (node.textContent !== display) node.textContent = display;
  }
  for (const node of definitions) {
    let source: string;
    try { source = decodeURIComponent(node.getAttribute(FOOTNOTE_SOURCE_ATTR) ?? ""); }
    catch { continue; }
    const label = /^\[\^([^\]\s]+)\]:/.exec(source)?.[1];
    const target = node.querySelector(".wiki-richtext-footnote-label");
    if (!label || !target) continue;
    const display = `[${numbers.get(label) ?? label}]`;
    if (target.textContent !== display) target.textContent = display;
  }
}

/** Keep footnote source atomic in the visual editor so Turndown can restore it. */
export function editableFootnotes(md: MarkdownIt): void {
  md.core.ruler.push("editable_footnote_numbers", (state) => {
    state.env.powerwikiFootnoteNumbers = /\[\^|\^\[/.test(state.src) ? footnoteNumbers(state.src) : new Map<string, number>();
    state.env.powerwikiFootnoteOccurrences = new Map<string, number>();
    state.env.powerwikiInlineFootnotes = inlineFootnotes(state.src);
    state.env.powerwikiInlineFootnoteIndex = 0;
    state.env.powerwikiFootnoteDefinitionSeen = false;
  });
  md.block.ruler.before("reference", "editable_footnote_definition", (state, start, end, silent) => {
    // Rendering a definition's body must not recursively render nested definitions.
    if (state.env.powerwikiInsideFootnote) return false;
    if (state.sCount[start] - state.blkIndent >= 4) return false;
    const line = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
    if (!/^\[\^[^\]\s]+\]:/.test(line)) return false;
    if (silent) return true;
    let next = start + 1;
    while (next < end) {
      if (state.isEmpty(next)) {
        let following = next + 1;
        while (following < end && state.isEmpty(following)) following++;
        if (following >= end || state.sCount[following] < state.blkIndent + 4) break;
        next = following;
      }
      if (state.sCount[next] < state.blkIndent + 4) break;
      next++;
    }
    const token = state.push("editable_footnote_definition", "", 0);
    token.content = state.getLines(start, next, state.blkIndent, false);
    token.map = [start, next];
    token.block = true;
    state.line = next;
    return true;
  }, { alt: ["paragraph", "reference"] });

  md.inline.ruler.before("link", "editable_footnote_reference", (state, silent) => {
    const source = state.src.slice(state.pos);
    const named = /^\[\^[^\]\s]+\]/.exec(source)?.[0];
    let raw = named;
    if (!raw && source.startsWith("^[")) {
      const closing = state.md.helpers.parseLinkLabel(state, state.pos + 1);
      if (closing >= 0) raw = state.src.slice(state.pos, closing + 1);
    }
    if (!raw) return false;
    if (!silent) {
      const token = state.push("editable_footnote_reference", "", 0);
      token.content = raw;
    }
    state.pos += raw.length;
    return true;
  });

  md.renderer.rules.editable_footnote_reference = (tokens, index, _options, env) => {
    const source = tokens[index].content;
    const label = source.slice(2, -1);
    const inlineIndex = Number(env?.powerwikiInlineFootnoteIndex ?? 0);
    if (!source.startsWith("[^") && env) env.powerwikiInlineFootnoteIndex = inlineIndex + 1;
    const number = source.startsWith("[^") ? (env?.powerwikiFootnoteNumbers as Map<string, number> | undefined)?.get(label) : (env?.powerwikiInlineFootnotes as Array<{ number: number }> | undefined)?.[inlineIndex]?.number;
    const occurrences = env?.powerwikiFootnoteOccurrences as Map<string, number> | undefined;
    const occurrence = occurrences?.get(label) ?? 0;
    if (number !== undefined) occurrences?.set(label, occurrence + 1);
    const display = number === undefined && source.startsWith("[^") ? source : `[${number ?? label}${number !== undefined && occurrence ? `:${occurrence}` : ""}]`;
    return `<sup class="wiki-richtext-footnote-ref" ${FOOTNOTE_SOURCE_ATTR}="${encodeURIComponent(source)}" contenteditable="false">${md.utils.escapeHtml(display)}</sup>`;
  };
  md.renderer.rules.editable_footnote_definition = (tokens, index, _options, env) => {
    const source = tokens[index].content;
    const match = /^\[\^([^\]\s]+)\]:[ \t]?/.exec(source);
    if (!match) return "";
    const body = source.slice(match[0].length).replace(/^ {4}/gm, "");
    const content = md.render(body, { powerwikiInsideFootnote: true });
    const number = (env?.powerwikiFootnoteNumbers as Map<string, number> | undefined)?.get(match[1]);
    const first = !env?.powerwikiFootnoteDefinitionSeen;
    if (env) env.powerwikiFootnoteDefinitionSeen = true;
    return `<div class="wiki-richtext-footnote${first ? " wiki-richtext-footnote-first" : ""}" ${FOOTNOTE_SOURCE_ATTR}="${encodeURIComponent(source)}" contenteditable="false"><span class="wiki-richtext-footnote-label">[${md.utils.escapeHtml(String(number ?? match[1]))}]</span><div>${content}</div><button type="button" class="wiki-richtext-footnote-edit" aria-label="Edit footnote ${md.utils.escapeHtml(match[1])}">Edit</button></div>\n`;
  };
}
