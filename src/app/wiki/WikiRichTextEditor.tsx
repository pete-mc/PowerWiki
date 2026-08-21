import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MarkdownIt from "markdown-it";

import { adoImageSizePlugin } from "../../rendering/adoImageSizePlugin";
import { MENTION_ATTR, MENTION_SELECTOR, adoMentionsPlugin } from "../../rendering/adoMentionsPlugin";
import { createRichTextTurndown } from "./richTextTurndown";
import { looseHeadingsPlugin } from "../../rendering/looseHeadingsPlugin";
import {
  filesFromDataTransfer,
  isImageFile,
  type UploadAttachment,
} from "../../wiki/attachmentUpload";
import type { MentionIdentity } from "../../rendering/MarkdownPreview";
import type { MentionSearch } from "./mentionCompletions";
import { searchMentions } from "./mentionCompletions";
import { insideExistingMention, matchMentionTrigger } from "./mentionTrigger";

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
  /**
   * Asks the user for a value. Supplied by the host, because a VS Code webview
   * iframe is sandboxed without `allow-modals` and `window.prompt` returns null
   * there — the "insert link" button would silently do nothing.
   */
  readonly onPrompt?: (message: string, defaultValue?: string) => Promise<string | undefined>;
  /** Resolves a mention's GUID to a display name, so a chip reads as a person. */
  readonly onLoadMention?: (id: string) => Promise<MentionIdentity>;
  /** Searches people and teams for the `@` picker. Absent turns the picker off. */
  readonly onSearchIdentities?: MentionSearch;
  readonly value: string;
}

export function WikiRichTextEditor({
  currentPath,
  disabled,
  onChange,
  onResolveImageSrc,
  onLoadImage,
  onUploadAttachment,
  onPrompt,
  onLoadMention,
  onSearchIdentities,
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
  // The open `@` picker: where to draw it, what it found, and which row is
  // highlighted. Null when there is no active trigger.
  const [mentionUi, setMentionUi] = useState<
    { top: number; left: number; matches: readonly MentionIdentity[]; active: number } | null
  >(null);
  // Guards against a slow search landing after the user typed on or dismissed.
  const mentionQueryRef = useRef("");
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

  /**
   * Replaces each mention placeholder's text with the person's name.
   *
   * The stored Markdown is a GUID, and the plugin renders it as "@…" until
   * something resolves it. In a WYSIWYG editor an unresolved GUID is worse than
   * useless - the author cannot tell who they mentioned - so this does for the
   * editable surface what the preview's enrichment does for the rendered page.
   *
   * Best-effort: a name that will not resolve leaves the chip as it was rather
   * than emptying it, and the data attribute is untouched either way, so what
   * gets saved never depends on whether the lookup succeeded.
   */
  const nameMentions = useCallback(
    (root: HTMLElement) => {
      for (const chip of Array.from(root.querySelectorAll<HTMLElement>(MENTION_SELECTOR))) {
        const id = chip.getAttribute(MENTION_ATTR);
        if (!id) {
          continue;
        }

        // Atomic, and this is not cosmetic. A mention is a single value: without
        // it the caret can sit *inside* the chip - which is where Ctrl+End lands
        // when a mention ends the document - and anything typed there joins the
        // span. The Turndown rule then writes the chip out as its identity and
        // the typed words are gone. Seen happening before this line existed.
        chip.contentEditable = "false";

        if (!onLoadMention || chip.dataset.powerwikiMentionNamed === "1") {
          continue;
        }
        chip.dataset.powerwikiMentionNamed = "1";
        onLoadMention(id)
          .then((identity) => {
            chip.textContent = `@${identity.displayName}`;
            chip.title = identity.uniqueName ?? identity.displayName;
          })
          .catch(() => {
            // Leave the placeholder; the mention itself is still intact.
          });
      }
    },
    [onLoadMention]
  );

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
      .use(adoMentionsPlugin)
      .use(looseHeadingsPlugin);
    // Resolve stored image paths (e.g. "/.attachments/x.png") to a displayable
    // URL for the editable surface, keeping the original path in data-wiki-src
    // so the Turndown rule below can emit portable Markdown on the way out.
    const defaultImage = md.renderer.rules.image;
    md.renderer.rules.image = (tokens, index, options, env, self) => {
      const token = tokens[index];
      const srcIndex = token.attrIndex("src");
      if (srcIndex >= 0) {
        // markdown-it 15 widened attribute values to `string | number`; an
        // image src is always textual, so normalise it here.
        const original = String(token.attrs![srcIndex][1]);
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
  const turndown = useMemo(() => createRichTextTurndown(), []);

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
    nameMentions(editor);
  }, [nameMentions, renderer, swapAttachmentImages, value]);

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

  async function insertLink() {
    if (disabled) {
      return;
    }

    const ask = onPrompt ?? ((message: string, defaultValue?: string) =>
      Promise.resolve(window.prompt(message, defaultValue) ?? undefined));
    const url = (await ask("Link URL", "https://"))?.trim();
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

  const closeMentionPicker = useCallback(() => {
    mentionQueryRef.current = "";
    setMentionUi(null);
  }, []);

  /**
   * Writes the picked identity in place of the "@query" the user typed.
   *
   * Goes through execCommand rather than direct DOM surgery so the insertion
   * joins the browser's own undo stack - a mention inserted here has to be
   * undoable with Ctrl+Z like every other edit in this editor.
   */
  const insertMention = useCallback(
    (identity: MentionIdentity) => {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection || selection.rangeCount === 0) {
        return;
      }

      const range = selection.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType !== Node.TEXT_NODE || !editor.contains(node)) {
        closeMentionPicker();
        return;
      }

      const textUpToCaret = (node.textContent ?? "").slice(0, range.startOffset);
      const trigger = matchMentionTrigger(textUpToCaret);
      if (!trigger) {
        closeMentionPicker();
        return;
      }

      // Select the "@query" so insertHTML replaces it rather than appending.
      range.setStart(node, trigger.atIndex);
      selection.removeAllRanges();
      selection.addRange(range);

      const escapedId = identity.id.replace(/"/g, "&quot;");
      const escapedName = identity.displayName
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      document.execCommand(
        "insertHTML",
        false,
        `<span class="powerwiki-mention" contenteditable="false" ${MENTION_ATTR}="${escapedId}" data-powerwiki-mention-named="1">@${escapedName}</span>&nbsp;`
      );
      closeMentionPicker();
      syncMarkdownFromDom();
    },
    [closeMentionPicker]
  );

  /**
   * Looks at the text before the caret and opens, updates or closes the picker.
   *
   * Runs on every input and caret move, so it must be cheap when there is no
   * trigger - which is nearly always. `matchMentionTrigger` answers that from
   * the text alone, and only a genuine trigger reaches the identity service.
   */
  const refreshMentionPicker = useCallback(() => {
    const editor = editorRef.current;
    const shell = shellRef.current;
    const selection = window.getSelection();
    if (!onSearchIdentities || !editor || !shell || !selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || !editor.contains(node)) {
      closeMentionPicker();
      return;
    }

    const textUpToCaret = (node.textContent ?? "").slice(0, range.startOffset);
    if (insideExistingMention(textUpToCaret)) {
      closeMentionPicker();
      return;
    }

    const trigger = matchMentionTrigger(textUpToCaret);
    const query = trigger?.query.trim() ?? "";
    if (!trigger || query.length < 2) {
      closeMentionPicker();
      return;
    }

    mentionQueryRef.current = query;
    const caret = range.getBoundingClientRect();
    const shellBox = shell.getBoundingClientRect();
    // A collapsed range at the start of a line reports a zero rect; fall back to
    // the editor's own box so the picker still appears somewhere sensible.
    const top = (caret.bottom || editor.getBoundingClientRect().top) - shellBox.top + 4;
    const left = (caret.left || editor.getBoundingClientRect().left) - shellBox.left;

    void searchMentions(query, onSearchIdentities)
      .then((matches) => {
        // Discard results for a query the user has already typed past.
        if (mentionQueryRef.current !== query) {
          return;
        }
        setMentionUi(matches.length > 0 ? { top, left, matches, active: 0 } : null);
      })
      .catch(() => setMentionUi(null));
  }, [closeMentionPicker, onSearchIdentities]);

  /** Arrow/Enter/Escape belong to the picker while it is open. */
  const handleMentionKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!mentionUi) {
        return false;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setMentionUi((ui) =>
          ui ? { ...ui, active: (ui.active + step + ui.matches.length) % ui.matches.length } : ui
        );
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insertMention(mentionUi.matches[mentionUi.active]);
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeMentionPicker();
        return true;
      }
      return false;
    },
    [closeMentionPicker, insertMention, mentionUi]
  );

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
        <button disabled={disabled} onClick={() => void insertLink()} type="button">Link</button>
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
        onBlur={() => {
          setTableUi(null);
          // Deferred: a click on a picker row blurs the editor before the click
          // lands, and closing here immediately would unmount the row first.
          window.setTimeout(closeMentionPicker, 150);
        }}
        onInput={(event) => {
          const markdown = turndown.turndown(event.currentTarget.innerHTML);
          lastAppliedValueRef.current = markdown;
          onChange(markdown);
          refreshMentionPicker();
        }}
        onKeyDown={(event) => {
          handleMentionKeyDown(event);
        }}
        onKeyUp={(event) => {
          // Caret moves that are not edits (arrows, Home/End) can leave or enter
          // a trigger, and onInput does not fire for them.
          if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
            refreshMentionPicker();
          }
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
      {mentionUi ? (
        <div
          aria-label="Mention a person or team"
          className="wiki-richtext-mention-picker"
          // Keep the caret: a mousedown that stole focus would collapse the
          // selection the insertion needs.
          onMouseDown={(event) => event.preventDefault()}
          role="listbox"
          style={{ left: mentionUi.left, top: mentionUi.top }}
        >
          {mentionUi.matches.map((identity, index) => (
            <button
              aria-selected={index === mentionUi.active}
              className={
                index === mentionUi.active
                  ? "wiki-richtext-mention-item active"
                  : "wiki-richtext-mention-item"
              }
              key={identity.id}
              onClick={() => insertMention(identity)}
              role="option"
              type="button"
            >
              <span className="wiki-richtext-mention-name">{identity.displayName}</span>
              {identity.uniqueName ? (
                <span className="wiki-richtext-mention-detail">{identity.uniqueName}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
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
