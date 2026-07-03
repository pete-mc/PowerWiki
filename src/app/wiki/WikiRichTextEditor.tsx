import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MarkdownIt from "markdown-it";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

import {
  filesFromDataTransfer,
  isImageFile,
  type UploadAttachment,
} from "../../wiki/attachmentUpload";

interface WikiRichTextEditorProps {
  readonly currentPath?: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
  /** Resolves a stored image path to a displayable URL for the preview surface. */
  readonly onResolveImageSrc?: (src: string, currentPath: string) => string | undefined;
  /** Uploads a pasted/dropped/picked file and returns its wiki reference. */
  readonly onUploadAttachment?: UploadAttachment;
  readonly value: string;
}

export function WikiRichTextEditor({
  currentPath,
  disabled,
  onChange,
  onResolveImageSrc,
  onUploadAttachment,
  value,
}: WikiRichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAppliedValueRef = useRef<string>("");
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadError, setUploadError] = useState<string>();
  // Kept in refs so the memoized renderer's image rule always resolves against
  // the current page/resolver without rebuilding the renderer.
  const resolveImageRef = useRef(onResolveImageSrc);
  const currentPathRef = useRef(currentPath);
  useEffect(() => {
    resolveImageRef.current = onResolveImageSrc;
    currentPathRef.current = currentPath;
  }, [currentPath, onResolveImageSrc]);

  const renderer = useMemo(() => {
    const md = new MarkdownIt({ breaks: false, html: false, linkify: true, typographer: true });
    // Resolve stored image paths (e.g. "/.attachments/x.png") to a displayable
    // URL for the editable surface, keeping the original path in data-wiki-src
    // so the Turndown rule below can emit portable Markdown on the way out.
    const defaultImage = md.renderer.rules.image;
    md.renderer.rules.image = (tokens, index, options, env, self) => {
      const token = tokens[index];
      const srcIndex = token.attrIndex("src");
      if (srcIndex >= 0) {
        const original = token.attrs![srcIndex][1];
        const resolved = resolveImageRef.current?.(original, currentPathRef.current ?? "") ?? original;
        token.attrs![srcIndex][1] = resolved;
        token.attrPush(["data-wiki-src", original]);
      }
      return defaultImage
        ? defaultImage(tokens, index, options, env, self)
        : self.renderToken(tokens, index, options);
    };
    return md;
  }, []);
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

    // Emit the portable wiki path (stashed in data-wiki-src when an image was
    // resolved for display) instead of the resolved CDN URL, so stored Markdown
    // stays readable in the built-in Azure DevOps Wiki.
    service.addRule("wikiImage", {
      filter: "img",
      replacement: (_content, node) => {
        const element = node as HTMLElement;
        const src = element.getAttribute("data-wiki-src") || element.getAttribute("src") || "";
        if (!src) {
          return "";
        }
        const alt = element.getAttribute("alt") ?? "";
        const url = src.replace(/ /g, "%20");
        return `![${alt}](${url})`;
      }
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

  // Inserts an uploaded image: the resolved URL is shown on the editable surface
  // while the portable wiki path rides along in data-wiki-src for serialization.
  function insertUploadedImage(displaySrc: string, wikiPath: string, alt: string) {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    editor.focus();
    const img = document.createElement("img");
    img.src = displaySrc;
    img.setAttribute("data-wiki-src", wikiPath);
    img.alt = alt;
    document.execCommand("insertHTML", false, `${img.outerHTML}<p><br></p>`);
    syncMarkdownFromDom();
  }

  const uploadFiles = useCallback(
    async (files: readonly File[]) => {
      if (!onUploadAttachment || files.length === 0) {
        return;
      }

      setUploadError(undefined);
      setUploadCount((count) => count + files.length);
      for (const file of files) {
        try {
          const result = await onUploadAttachment(file);
          const displaySrc = resolveImageRef.current?.(result.path, currentPathRef.current ?? "") ?? result.path;
          if (result.isImage) {
            insertUploadedImage(displaySrc, result.path, result.name);
          } else {
            const url = result.path.replace(/ /g, "%20");
            document.execCommand("insertHTML", false, `<a href="${url}">${result.name}</a>&nbsp;`);
            syncMarkdownFromDom();
          }
        } catch (error: unknown) {
          setUploadError(error instanceof Error ? error.message : "Upload failed.");
        } finally {
          setUploadCount((count) => count - 1);
        }
      }
    },
    // insertUploadedImage/syncMarkdownFromDom close over stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onUploadAttachment]
  );

  function insertImage() {
    if (disabled || !onUploadAttachment) {
      return;
    }
    fileInputRef.current?.click();
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
        <button disabled={disabled || !onUploadAttachment || uploadCount > 0} onClick={insertImage} type="button">Image</button>
        <button disabled={disabled} onClick={insertTable} type="button">Table</button>
        <button disabled={disabled} onClick={() => addTableRow(true)} type="button">Row+</button>
        <button disabled={disabled} onClick={removeTableRow} type="button">Row-</button>
        <button disabled={disabled} onClick={() => addTableColumn(true)} type="button">Col+</button>
        <button disabled={disabled} onClick={removeTableColumn} type="button">Col-</button>
        {uploadCount > 0 ? <span className="wiki-richtext-status" role="status">Uploading…</span> : null}
        {uploadError ? <span className="wiki-richtext-status wiki-richtext-status-error" role="alert">{uploadError}</span> : null}
        <input
          accept="image/*"
          hidden
          multiple
          onChange={(event) => {
            const files = event.target.files ? Array.from(event.target.files) : [];
            event.target.value = "";
            void uploadFiles(files);
          }}
          ref={fileInputRef}
          type="file"
        />
      </div>
      <div
        aria-label="Rich text markdown editor"
        className="wiki-richtext-editor"
        contentEditable={!disabled}
        onDragOver={(event) => {
          if (onUploadAttachment && Array.from(event.dataTransfer.types).includes("Files")) {
            event.preventDefault();
          }
        }}
        onDrop={(event) => {
          if (!onUploadAttachment) {
            return;
          }
          const files = filesFromDataTransfer(event.dataTransfer);
          if (files.length === 0) {
            return;
          }
          event.preventDefault();
          void uploadFiles(files);
        }}
        onInput={(event) => {
          const markdown = turndown.turndown(event.currentTarget.innerHTML);
          lastAppliedValueRef.current = markdown;
          onChange(markdown);
        }}
        onPaste={(event) => {
          if (!onUploadAttachment) {
            return;
          }
          const images = filesFromDataTransfer(event.clipboardData).filter(isImageFile);
          if (images.length === 0) {
            return;
          }
          event.preventDefault();
          void uploadFiles(images);
        }}
        ref={editorRef}
        role="textbox"
        suppressContentEditableWarning
      />
    </div>
  );
}
