import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MarkdownIt from "markdown-it";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

import { adoImageSizePlugin } from "../../rendering/adoImageSizePlugin";
import { looseHeadingsPlugin } from "../../rendering/looseHeadingsPlugin";
import {
  filesFromDataTransfer,
  isImageFile,
  type UploadAttachment,
} from "../../wiki/attachmentUpload";

interface WikiRichTextEditorProps {
  readonly currentPath?: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
  /** Resolves a stored image path to its authenticated Git Items URL. */
  readonly onResolveImageSrc?: (src: string, currentPath: string) => string | undefined;
  /** Fetches a resolved URL as a displayable object URL (authenticated). */
  readonly onLoadImage?: (url: string) => Promise<string>;
  /** Uploads a pasted/dropped/picked file and returns its wiki reference. */
  readonly onUploadAttachment?: UploadAttachment;
  readonly value: string;
}

export function WikiRichTextEditor({
  currentPath,
  disabled,
  onChange,
  onResolveImageSrc,
  onLoadImage,
  onUploadAttachment,
  value,
}: WikiRichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAppliedValueRef = useRef<string>("");
  // The table cell the caret is currently in, so the floating table toolbar can
  // act on it even after a toolbar click moves focus off the caret.
  const activeCellRef = useRef<HTMLTableCellElement | null>(null);
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadError, setUploadError] = useState<string>();
  // Position of the floating table toolbar (relative to the shell), or null when
  // the caret is not inside a table.
  const [tableUi, setTableUi] = useState<{ top: number; left: number } | null>(null);
  // Kept in refs so the memoized renderer's image rule always resolves against
  // the current page/resolver without rebuilding the renderer.
  const resolveImageRef = useRef(onResolveImageSrc);
  const loadImageRef = useRef(onLoadImage);
  const currentPathRef = useRef(currentPath);
  useEffect(() => {
    resolveImageRef.current = onResolveImageSrc;
    loadImageRef.current = onLoadImage;
    currentPathRef.current = currentPath;
  }, [currentPath, onLoadImage, onResolveImageSrc]);
  // Object URLs created for authenticated attachment images, keyed by resolved
  // URL, so the editable surface can display them; revoked when the editor
  // unmounts. See swapAttachmentImages.
  const imageObjectUrlsRef = useRef(new Map<string, string>());
  useEffect(() => {
    const cache = imageObjectUrlsRef.current;
    return () => {
      for (const objectUrl of cache.values()) {
        URL.revokeObjectURL(objectUrl);
      }
      cache.clear();
    };
  }, []);
  // Replaces the failing authenticated-URL <img src>s in the editable surface
  // with credentialed object URLs. Keeps data-wiki-src (the portable path) so
  // serialization still emits clean Markdown.
  const swapAttachmentImages = useCallback((editor: HTMLElement) => {
    const load = loadImageRef.current;
    if (!load) {
      return;
    }
    const cache = imageObjectUrlsRef.current;
    for (const image of Array.from(editor.querySelectorAll<HTMLImageElement>("img[data-powerwiki-authed]"))) {
      const target = image.getAttribute("src");
      if (!target || target.startsWith("blob:")) {
        continue;
      }
      const cached = cache.get(target);
      if (cached) {
        image.src = cached;
        continue;
      }
      void load(target)
        .then((objectUrl) => {
          cache.set(target, objectUrl);
          image.src = objectUrl;
        })
        .catch(() => {
          // Leave the (broken) image in place.
        });
    }
  }, []);

  const renderer = useMemo(() => {
    // The image-size plugin is shared with the preview renderer: without it
    // markdown-it rejects `![alt](x.png =500x250)` outright, and Turndown would
    // then escape the leftover literal text on the way back out, corrupting the
    // stored Markdown.
    // looseHeadingsPlugin keeps the visual editor in step with the preview, so a
    // spaceless `#Title` shows as a heading here too (Turndown then writes it
    // back out in the canonical `# Title` form).
    const md = new MarkdownIt({ breaks: false, html: false, linkify: true, typographer: true })
      .use(adoImageSizePlugin)
      .use(looseHeadingsPlugin);
    // Resolve stored image paths (e.g. "/.attachments/x.png") to a displayable
    // URL for the editable surface, keeping the original path in data-wiki-src
    // so the Turndown rule below can emit portable Markdown on the way out.
    const defaultImage = md.renderer.rules.image;
    md.renderer.rules.image = (tokens, index, options, env, self) => {
      const token = tokens[index];
      const srcIndex = token.attrIndex("src");
      if (srcIndex >= 0) {
        const original = token.attrs![srcIndex][1];
        const resolved = resolveImageRef.current?.(original, currentPathRef.current ?? "");
        token.attrPush(["data-wiki-src", original]);
        if (resolved) {
          // A wiki attachment resolved to an authenticated Git Items URL: mark it
          // so swapAttachmentImages fetches it with credentials. External images
          // keep their original src and are never sent the access token.
          token.attrs![srcIndex][1] = resolved;
          token.attrPush(["data-powerwiki-authed", "1"]);
        }
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
        // Preserve an authored `=WxH` size across the round trip.
        const width = element.getAttribute("width") ?? "";
        const height = element.getAttribute("height") ?? "";
        const size = width || height ? ` =${width}x${height}` : "";
        return `![${alt}](${url}${size})`;
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
    swapAttachmentImages(editor);
  }, [renderer, swapAttachmentImages, value]);

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

  // Repositions the floating table toolbar over the active cell's table, or
  // hides it when the caret is no longer in a table inside the editor.
  const updateTableToolbar = useCallback(() => {
    const cell = activeCellRef.current;
    const editor = editorRef.current;
    const shell = shellRef.current;
    if (!cell || !editor || !shell || !editor.contains(cell)) {
      setTableUi(null);
      return;
    }

    const table = cell.closest("table");
    if (!table) {
      setTableUi(null);
      return;
    }

    const shellRect = shell.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    setTableUi({ top: tableRect.top - shellRect.top, left: tableRect.left - shellRect.left });
  }, []);

  // Tracks the active table cell as the caret moves, and keeps the toolbar
  // pinned to the table on scroll/resize. The toolbar buttons preventDefault on
  // mousedown so clicking them doesn't move the caret out of the cell.
  useEffect(() => {
    function onSelectionChange() {
      const editor = editorRef.current;
      const node = document.getSelection()?.anchorNode;
      if (!editor || !node || !editor.contains(node)) {
        return;
      }

      const element = node instanceof Element ? node : node.parentElement;
      const cell = element?.closest<HTMLTableCellElement>("td, th");
      if (cell && editor.contains(cell)) {
        activeCellRef.current = cell;
        updateTableToolbar();
      } else {
        activeCellRef.current = null;
        setTableUi(null);
      }
    }

    const editor = editorRef.current;
    document.addEventListener("selectionchange", onSelectionChange);
    editor?.addEventListener("scroll", updateTableToolbar);
    window.addEventListener("resize", updateTableToolbar);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      editor?.removeEventListener("scroll", updateTableToolbar);
      window.removeEventListener("resize", updateTableToolbar);
    };
  }, [updateTableToolbar]);

  function withActiveCell(
    action: (context: {
      table: HTMLTableElement;
      row: HTMLTableRowElement;
      cell: HTMLTableCellElement;
      rowIndex: number;
      cellIndex: number;
    }) => void
  ) {
    if (disabled) {
      return;
    }

    const cell = activeCellRef.current;
    const editor = editorRef.current;
    if (!cell || !editor || !editor.contains(cell)) {
      return;
    }

    const row = cell.parentElement;
    const table = cell.closest("table");
    if (!(row instanceof HTMLTableRowElement) || !(table instanceof HTMLTableElement)) {
      return;
    }

    action({ table, row, cell, rowIndex: row.rowIndex, cellIndex: cell.cellIndex });
    syncMarkdownFromDom();
    requestAnimationFrame(updateTableToolbar);
  }

  function addTableRow(after: boolean) {
    withActiveCell(({ row }) => {
      const section = row.parentElement;
      if (!(section instanceof HTMLTableSectionElement)) {
        return;
      }

      const newRow = document.createElement("tr");
      for (const sourceCell of Array.from(row.cells)) {
        // New rows are always body cells even when cloned from a header row.
        const newCell = document.createElement(sourceCell.tagName.toLowerCase() === "th" && section.tagName === "THEAD" ? "th" : "td");
        newCell.innerHTML = "<br>";
        newRow.appendChild(newCell);
      }
      section.insertBefore(newRow, after ? row.nextElementSibling : row);
    });
  }

  function removeTableRow() {
    withActiveCell(({ table, rowIndex }) => {
      if (table.rows.length > 1) {
        table.deleteRow(rowIndex);
        activeCellRef.current = null;
      }
    });
  }

  function moveTableRow(down: boolean) {
    withActiveCell(({ row }) => {
      const sibling = down ? row.nextElementSibling : row.previousElementSibling;
      if (!(sibling instanceof HTMLTableRowElement) || row.parentElement !== sibling.parentElement) {
        return;
      }
      if (down) {
        row.parentElement?.insertBefore(sibling, row);
      } else {
        row.parentElement?.insertBefore(row, sibling);
      }
    });
  }

  function addTableColumn(after: boolean) {
    withActiveCell(({ table, cellIndex }) => {
      const insertIndex = after ? cellIndex + 1 : cellIndex;
      for (const row of Array.from(table.rows)) {
        const referenceCell = row.cells.item(cellIndex);
        const cell = document.createElement(referenceCell?.tagName.toLowerCase() === "th" ? "th" : "td");
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
    withActiveCell(({ table, cellIndex }) => {
      const firstRow = table.rows.item(0);
      if (!firstRow || firstRow.cells.length <= 1) {
        return;
      }
      for (const row of Array.from(table.rows)) {
        row.cells.item(cellIndex)?.remove();
      }
      activeCellRef.current = null;
    });
  }

  function moveTableColumn(right: boolean) {
    withActiveCell(({ table, cellIndex }) => {
      const targetIndex = right ? cellIndex + 1 : cellIndex - 1;
      const width = table.rows.item(0)?.cells.length ?? 0;
      if (targetIndex < 0 || targetIndex >= width) {
        return;
      }
      for (const row of Array.from(table.rows)) {
        const cell = row.cells.item(cellIndex);
        const target = row.cells.item(targetIndex);
        if (!cell || !target) {
          continue;
        }
        if (right) {
          row.insertBefore(target, cell);
        } else {
          row.insertBefore(cell, target);
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
    img.setAttribute("data-powerwiki-authed", "1");
    img.alt = alt;
    document.execCommand("insertHTML", false, `${img.outerHTML}<p><br></p>`);
    // Swap the just-inserted authenticated URL for a credentialed object URL so
    // it actually displays (data-wiki-src keeps the portable path for save).
    swapAttachmentImages(editor);
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
    <div className="wiki-richtext-shell" ref={shellRef}>
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
        onBlur={() => setTableUi(null)}
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
      {tableUi ? (
        <div
          className="wiki-richtext-table-tools"
          onMouseDown={(event) => event.preventDefault()}
          role="toolbar"
          aria-label="Table editing"
          style={{ left: tableUi.left, top: tableUi.top }}
        >
          <span className="wiki-richtext-table-group" aria-label="Rows">
            <span className="wiki-richtext-table-label">Row</span>
            <button onClick={() => addTableRow(false)} title="Insert row above" type="button">＋↑</button>
            <button onClick={() => addTableRow(true)} title="Insert row below" type="button">＋↓</button>
            <button onClick={() => moveTableRow(false)} title="Move row up" type="button">↑</button>
            <button onClick={() => moveTableRow(true)} title="Move row down" type="button">↓</button>
            <button className="wiki-richtext-table-delete" onClick={removeTableRow} title="Delete row" type="button">✕</button>
          </span>
          <span className="wiki-richtext-table-sep" aria-hidden="true" />
          <span className="wiki-richtext-table-group" aria-label="Columns">
            <span className="wiki-richtext-table-label">Col</span>
            <button onClick={() => addTableColumn(false)} title="Insert column left" type="button">＋←</button>
            <button onClick={() => addTableColumn(true)} title="Insert column right" type="button">＋→</button>
            <button onClick={() => moveTableColumn(false)} title="Move column left" type="button">←</button>
            <button onClick={() => moveTableColumn(true)} title="Move column right" type="button">→</button>
            <button className="wiki-richtext-table-delete" onClick={removeTableColumn} title="Delete column" type="button">✕</button>
          </span>
        </div>
      ) : null}
    </div>
  );
}
