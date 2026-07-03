import { useEffect, useMemo, useRef } from "react";

import MarkdownIt from "markdown-it";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

interface WikiRichTextEditorProps {
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
  readonly value: string;
}

export function WikiRichTextEditor({ disabled, onChange, value }: WikiRichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastAppliedValueRef = useRef<string>("");
  const renderer = useMemo(
    () => new MarkdownIt({ breaks: false, html: false, linkify: true, typographer: true }),
    []
  );
  const turndown = useMemo(() => {
    const service = new TurndownService({
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      emDelimiter: "_",
      headingStyle: "atx",
      hr: "---",
      linkStyle: "inlined"
    });

    // GFM support so HTML tables, strikethrough, and task lists round-trip to
    // Markdown table/`~~`/`- [ ]` syntax instead of being flattened to text.
    service.use(gfm);

    // Keep line-break intentions when users hit Enter+Shift in rich text mode.
    service.addRule("lineBreak", {
      filter: "br",
      replacement: () => "  \n"
    });

    return service;
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    if (lastAppliedValueRef.current === value) {
      return;
    }

    editor.innerHTML = value.trim().length > 0 ? renderer.render(value) : "<p><br></p>";
    lastAppliedValueRef.current = value;
  }, [renderer, value]);

  function runCommand(command: string, commandValue?: string) {
    if (disabled) {
      return;
    }

    editorRef.current?.focus();
    document.execCommand(command, false, commandValue);
    syncMarkdownFromDom();
  }

  function syncMarkdownFromDom() {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const markdown = turndown.turndown(editor.innerHTML);
    lastAppliedValueRef.current = markdown;
    onChange(markdown);
  }

  function insertTable() {
    if (disabled) {
      return;
    }

    editorRef.current?.focus();
    document.execCommand(
      "insertHTML",
      false,
      [
        "<table><thead><tr><th>Column 1</th><th>Column 2</th></tr></thead>",
        "<tbody><tr><td>Value</td><td>Value</td></tr></tbody></table><p><br></p>",
      ].join("")
    );
    syncMarkdownFromDom();
  }

  function withSelectedCell(action: (table: HTMLTableElement, rowIndex: number, cellIndex: number) => void) {
    if (disabled) {
      return;
    }

    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    if (!anchor) {
      return;
    }

    const cell = anchor instanceof Element
      ? anchor.closest<HTMLTableCellElement>("td, th")
      : anchor.parentElement?.closest<HTMLTableCellElement>("td, th");
    if (!cell) {
      return;
    }

    const row = cell.parentElement;
    const table = row?.closest("table");
    if (!(row instanceof HTMLTableRowElement) || !(table instanceof HTMLTableElement)) {
      return;
    }

    action(table, row.rowIndex, cell.cellIndex);
    syncMarkdownFromDom();
  }

  function addTableRow(after: boolean) {
    withSelectedCell((table, rowIndex) => {
      const sourceRow = table.rows.item(rowIndex);
      if (!sourceRow) {
        return;
      }

      const insertIndex = after ? rowIndex + 1 : rowIndex;
      const body = sourceRow.parentElement;
      if (!(body instanceof HTMLTableSectionElement)) {
        return;
      }

      const newRow = body.insertRow(insertIndex - (table.tHead ? table.tHead.rows.length : 0));
      for (const sourceCell of Array.from(sourceRow.cells)) {
        const tagName = sourceCell.tagName.toLowerCase() === "th" ? "th" : "td";
        const newCell = document.createElement(tagName);
        newCell.innerHTML = "<br>";
        newRow.appendChild(newCell);
      }
    });
  }

  function removeTableRow() {
    withSelectedCell((table, rowIndex) => {
      if (table.rows.length <= 1) {
        return;
      }

      table.deleteRow(rowIndex);
    });
  }

  function addTableColumn(after: boolean) {
    withSelectedCell((table, _rowIndex, cellIndex) => {
      const insertIndex = after ? cellIndex + 1 : cellIndex;

      for (const row of Array.from(table.rows)) {
        const referenceCell = row.cells.item(cellIndex);
        const tagName = referenceCell?.tagName.toLowerCase() === "th" ? "th" : "td";
        const cell = document.createElement(tagName);
        cell.innerHTML = "<br>";

        const beforeNode = row.cells.item(insertIndex);
        if (beforeNode) {
          row.insertBefore(cell, beforeNode);
        } else {
          row.appendChild(cell);
        }
      }
    });
  }

  function removeTableColumn() {
    withSelectedCell((table, _rowIndex, cellIndex) => {
      const firstRow = table.rows.item(0);
      if (!firstRow || firstRow.cells.length <= 1) {
        return;
      }

      for (const row of Array.from(table.rows)) {
        const cell = row.cells.item(cellIndex);
        if (cell) {
          row.removeChild(cell);
        }
      }
    });
  }

  function insertLink() {
    if (disabled) {
      return;
    }

    const url = window.prompt("Link URL", "https://")?.trim();
    if (!url) {
      return;
    }

    runCommand("createLink", url);
  }

  function insertImage() {
    if (disabled) {
      return;
    }

    const url = window.prompt("Image URL", "https://")?.trim();
    if (!url) {
      return;
    }

    runCommand("insertImage", url);
  }

  return (
    <div className="wiki-richtext-shell">
      <div className="wiki-richtext-toolbar" role="toolbar" aria-label="Rich text formatting">
        <button disabled={disabled} onClick={() => runCommand("bold")} type="button">Bold</button>
        <button disabled={disabled} onClick={() => runCommand("italic")} type="button">Italic</button>
        <button disabled={disabled} onClick={() => runCommand("strikeThrough")} type="button">Strike</button>
        <button disabled={disabled} onClick={() => runCommand("formatBlock", "<h1>")} type="button">H1</button>
        <button disabled={disabled} onClick={() => runCommand("formatBlock", "<h2>")} type="button">H2</button>
        <button disabled={disabled} onClick={() => runCommand("formatBlock", "<h3>")} type="button">H3</button>
        <button disabled={disabled} onClick={() => runCommand("insertUnorderedList")} type="button">Bullet</button>
        <button disabled={disabled} onClick={() => runCommand("insertOrderedList")} type="button">Number</button>
        <button disabled={disabled} onClick={() => runCommand("formatBlock", "<blockquote>")} type="button">Quote</button>
        <button disabled={disabled} onClick={() => runCommand("formatBlock", "<pre>")} type="button">Code</button>
        <button disabled={disabled} onClick={insertLink} type="button">Link</button>
        <button disabled={disabled} onClick={insertImage} type="button">Image</button>
        <button disabled={disabled} onClick={insertTable} type="button">Table</button>
        <button disabled={disabled} onClick={() => addTableRow(true)} type="button">Row+</button>
        <button disabled={disabled} onClick={removeTableRow} type="button">Row-</button>
        <button disabled={disabled} onClick={() => addTableColumn(true)} type="button">Col+</button>
        <button disabled={disabled} onClick={removeTableColumn} type="button">Col-</button>
      </div>
      <div
        aria-label="Rich text markdown editor"
        className="wiki-richtext-editor"
        contentEditable={!disabled}
        onInput={(event) => {
          const markdown = turndown.turndown(event.currentTarget.innerHTML);
          lastAppliedValueRef.current = markdown;
          onChange(markdown);
        }}
        ref={editorRef}
        role="textbox"
        suppressContentEditableWarning
      />
    </div>
  );
}
