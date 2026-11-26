import MarkdownIt from "markdown-it";
import { footnote, type FootNoteEnv } from "@mdit/plugin-footnote";

const parser = new MarkdownIt().use(footnote);

/** Inline notes and their preview numbers, in reference order. */
export function inlineFootnotes(markdown: string): Array<{ number: number; content: string }> {
  const env: FootNoteEnv = {};
  parser.parse(markdown, env);
  return (env.footnotes?.list ?? []).flatMap((note, index) =>
    !note.label && typeof note.content === "string" ? [{ number: index + 1, content: note.content }] : []
  );
}

/** Display numbers in the same order as the rendered preview. */
export function footnoteNumbers(markdown: string): Map<string, number> {
  const env: FootNoteEnv = {};
  parser.parse(markdown, env);
  const numbers = new Map<string, number>();
  env.footnotes?.list?.forEach((note, index) => {
    if (note.label) numbers.set(note.label, index + 1);
  });
  return numbers;
}

/** Labels already used by references or definitions, including unfinished ones. */
export function nextFootnoteLabel(markdown: string): string {
  const used = new Set(Array.from(markdown.matchAll(/\[\^([^\]\s]+)\]/g), (match) => match[1].toLowerCase()));
  let number = 1;
  while (used.has(String(number))) number++;
  return String(number);
}

/** Existing definitions offered for reuse, in document order. */
export function footnoteLabels(markdown: string): string[] {
  const env: FootNoteEnv = {};
  parser.parse(markdown, env);
  return Object.keys(env.footnotes?.refs ?? {}).map((key) => key.slice(1));
}

