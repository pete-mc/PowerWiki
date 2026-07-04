// Slash-command palette for the Monaco Markdown editor. Typing "/" at the start
// of a line (or after whitespace) opens Monaco's completion widget with a list
// of insertable Markdown elements; accepting one replaces the "/filter" text
// with the element (snippet tab stops let the user fill in placeholders).
//
// Implemented as a completion provider rather than a bespoke popup so Monaco
// handles filtering, keyboard navigation, positioning, and snippet insertion.

import type * as Monaco from "monaco-editor";

import { MERMAID_SNIPPETS } from "./mermaidSnippets";

type MonacoApi = typeof Monaco;

export interface SlashCommand {
  /** Shown in the palette and used as the primary filter term. */
  readonly label: string;
  readonly detail: string;
  /** Extra words that also match this command when filtering. */
  readonly keywords?: string;
  /** Text (or snippet, when asSnippet) inserted in place of the "/filter". */
  readonly insertText: string;
  /** Whether insertText uses Monaco snippet syntax (${1:...} tab stops). */
  readonly asSnippet: boolean;
}

const BASE_COMMANDS: readonly SlashCommand[] = [
  { label: "Heading 1", detail: "Top-level heading", keywords: "h1 title", insertText: "# ${1:Heading}", asSnippet: true },
  { label: "Heading 2", detail: "Section heading", keywords: "h2", insertText: "## ${1:Heading}", asSnippet: true },
  { label: "Heading 3", detail: "Sub-section heading", keywords: "h3", insertText: "### ${1:Heading}", asSnippet: true },
  { label: "Bold", detail: "Bold text", keywords: "strong", insertText: "**${1:bold text}**", asSnippet: true },
  { label: "Italic", detail: "Italic text", keywords: "emphasis", insertText: "*${1:italic text}*", asSnippet: true },
  { label: "Inline code", detail: "Inline code span", keywords: "monospace", insertText: "`${1:code}`", asSnippet: true },
  { label: "Code block", detail: "Fenced code block", keywords: "fence pre", insertText: "```${1:language}\n${2:code}\n```", asSnippet: true },
  { label: "Quote", detail: "Block quote", keywords: "blockquote", insertText: "> ${1:quote}", asSnippet: true },
  { label: "Bulleted list", detail: "Unordered list", keywords: "ul unordered", insertText: "- ${1:item}", asSnippet: true },
  { label: "Numbered list", detail: "Ordered list", keywords: "ol ordered", insertText: "1. ${1:item}", asSnippet: true },
  {
    label: "Table",
    detail: "Insert a Markdown table",
    keywords: "grid",
    insertText: "| ${1:Column 1} | ${2:Column 2} |\n| --- | --- |\n| ${3:Cell} | ${4:Cell} |",
    asSnippet: true,
  },
  { label: "Link", detail: "Insert a link", keywords: "url href", insertText: "[${1:text}](${2:https://})", asSnippet: true },
  {
    label: "Work item reference",
    detail: "Reference a work item by id (#1234)",
    keywords: "issue bug task board",
    insertText: "#${1:1234}",
    asSnippet: true,
  },
  {
    label: "Query table",
    detail: "Embed an Azure Boards query result",
    keywords: "board query work items",
    insertText: "::: query-table ${1:query-id} :::",
    asSnippet: true,
  },
];

const MERMAID_COMMANDS: readonly SlashCommand[] = MERMAID_SNIPPETS.map((snippet) => ({
  label: `Mermaid: ${snippet.label}`,
  detail: `Insert a ${snippet.label.toLowerCase()} diagram`,
  keywords: "mermaid diagram chart",
  // Plain (not a snippet) — mermaid source contains { } that snippet mode would
  // misinterpret as tab-stop placeholders.
  insertText: "```mermaid\n" + snippet.code + "\n```\n",
  asSnippet: false,
}));

export const SLASH_COMMANDS: readonly SlashCommand[] = [...BASE_COMMANDS, ...MERMAID_COMMANDS];

/**
 * Detects a slash-command trigger in the text on the current line up to the
 * cursor. Only a "/" at line start or after whitespace triggers (so "http://"
 * and paths like "a/b" don't). Returns the typed filter and the 0-based index
 * of the "/", or null when there is no active trigger.
 */
export function matchSlashTrigger(lineUpToCursor: string): { filter: string; slashIndex: number } | null {
  const match = /(?:^|\s)\/(\w*)$/.exec(lineUpToCursor);
  if (!match) {
    return null;
  }

  const filter = match[1] ?? "";
  return { filter, slashIndex: lineUpToCursor.length - filter.length - 1 };
}

let registered = false;

/** Registers the slash-command completion provider once for the Markdown language. */
export function registerSlashCommands(monaco: MonacoApi): void {
  if (registered) {
    return;
  }
  registered = true;

  monaco.languages.registerCompletionItemProvider("markdown", {
    triggerCharacters: ["/"],
    provideCompletionItems(model, position) {
      const lineUpToCursor = model.getValueInRange({
        startColumn: 1,
        startLineNumber: position.lineNumber,
        endColumn: position.column,
        endLineNumber: position.lineNumber,
      });

      const trigger = matchSlashTrigger(lineUpToCursor);
      if (!trigger) {
        return { suggestions: [] };
      }

      const range = new monaco.Range(
        position.lineNumber,
        trigger.slashIndex + 1,
        position.lineNumber,
        position.column
      );

      const suggestions = SLASH_COMMANDS.map((command, index) => ({
        label: `/${command.label}`,
        detail: command.detail,
        kind: monaco.languages.CompletionItemKind.Snippet,
        insertText: command.insertText,
        insertTextRules: command.asSnippet
          ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
          : undefined,
        filterText: `/${command.label} ${command.keywords ?? ""}`,
        sortText: String(index).padStart(3, "0"),
        range,
      }));

      return { suggestions };
    },
  });
}
