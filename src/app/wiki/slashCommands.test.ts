import { describe, expect, it } from "vitest";

import { matchSlashTrigger, SLASH_COMMANDS } from "./slashCommands";

describe("matchSlashTrigger", () => {
  it("triggers on a slash at the start of a line", () => {
    expect(matchSlashTrigger("/")).toEqual({ filter: "", slashIndex: 0 });
    expect(matchSlashTrigger("/tab")).toEqual({ filter: "tab", slashIndex: 0 });
  });

  it("triggers on a slash after whitespace", () => {
    expect(matchSlashTrigger("some text /code")).toEqual({ filter: "code", slashIndex: 10 });
  });

  it("does not trigger inside a word or path", () => {
    expect(matchSlashTrigger("a/b")).toBeNull();
    expect(matchSlashTrigger("path/to/file")).toBeNull();
  });

  it("does not trigger inside a URL", () => {
    expect(matchSlashTrigger("see http://example.com/")).toBeNull();
  });

  it("stops matching once the filter would contain a space", () => {
    expect(matchSlashTrigger("/table then more")).toBeNull();
  });
});

describe("SLASH_COMMANDS", () => {
  it("includes the core Markdown elements", () => {
    const labels = SLASH_COMMANDS.map((c) => c.label);
    for (const expected of ["Table", "Link", "Code block", "Work item reference", "Query table"]) {
      expect(labels).toContain(expected);
    }
  });

  it("includes mermaid diagram commands that insert plain fenced blocks", () => {
    const mermaid = SLASH_COMMANDS.filter((c) => c.label.startsWith("Mermaid: "));
    expect(mermaid.length).toBeGreaterThan(5);
    for (const command of mermaid) {
      expect(command.asSnippet).toBe(false);
      expect(command.insertText.startsWith("```mermaid\n")).toBe(true);
    }
  });

  it("marks placeholder-bearing commands as snippets", () => {
    const table = SLASH_COMMANDS.find((c) => c.label === "Table");
    expect(table?.asSnippet).toBe(true);
    expect(table?.insertText).toContain("${1:");
  });
});
