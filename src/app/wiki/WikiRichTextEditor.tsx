import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MarkdownIt from "markdown-it";

import { adoImageSizePlugin } from "../../rendering/adoImageSizePlugin";
import { MENTION_ATTR, MENTION_SELECTOR, adoMentionsPlugin } from "../../rendering/adoMentionsPlugin";
import { createRichTextTurndown, pendingFootnoteDefinitions, richTextMarkdown } from "./richTextTurndown";
import { editableFootnotes, FOOTNOTE_PENDING_DEFINITION_ATTR, FOOTNOTE_SOURCE_ATTR, updateEditableFootnoteNumbers } from "./editableFootnotes";
import { footnoteLabels, footnoteNumbers, inlineFootnotes, nextFootnoteLabel } from "./footnoteAuthoring";
import { resizedSize, type ImageSize, type ResizeHandle } from "./imageResize";
import { editableEmojiPlugin } from "../../rendering/emojiPlugin";
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

/** Corner and edge handles, in visual order around the frame. */
const IMAGE_HANDLES: readonly ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
type HistorySelection = { start: number[]; startOffset: number; end: number[]; endOffset: number };
type HistoryEntry = { html: string; selection: HistorySelection | null };
const MAX_HISTORY_CHARS = 4_000_000;

function captureSelection(editor: HTMLElement): HistorySelection | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
  function path(node: Node): number[] {
    const indices: number[] = [];
    while (node !== editor && node.parentNode) {
      indices.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes, node) as number);
      node = node.parentNode;
    }
    return indices;
  }
  return { start: path(range.startContainer), startOffset: range.startOffset, end: path(range.endContainer), endOffset: range.endOffset };
}

function restoreSelection(editor: HTMLElement, saved: HistorySelection | null): void {
  if (!saved) return;
  function resolve(path: number[]): Node | undefined {
    let node: Node = editor;
    for (const index of path) {
      const child: ChildNode | undefined = node.childNodes[index];
      if (!child) return undefined;
      node = child;
    }
    return node;
  }
  const start = resolve(saved.start);
  const end = resolve(saved.end);
  if (!start || !end) return;
  const range = document.createRange();
  const limit = (node: Node) => node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : node.childNodes.length;
  range.setStart(start, Math.min(saved.startOffset, limit(start)));
  range.setEnd(end, Math.min(saved.endOffset, limit(end)));
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
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
  const editHistoryRef = useRef<{ past: HistoryEntry[]; current: HistoryEntry; future: HistoryEntry[]; typing: boolean } | null>(null);
  const restoringHistoryRef = useRef(false);
  const historyActionRef = useRef<(undo: boolean) => void>(() => {});
  const footnoteMenuRef = useRef<HTMLDivElement>(null);
  const lastSelectionRef = useRef<Range | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAppliedValueRef = useRef<string | undefined>(undefined);
  // The table cell the caret is currently in, so the floating table toolbar can
  // act on it even after a toolbar click moves focus off the caret.
  const activeCellRef = useRef<HTMLTableCellElement | null>(null);
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadError, setUploadError] = useState<string>();
  const [footnoteOpen, setFootnoteOpen] = useState(false);
  const [pendingFootnotes, setPendingFootnotes] = useState<readonly string[]>([]);
  const [editingFootnote, setEditingFootnote] = useState<{ node: HTMLElement; source: string; text: string; inline: boolean } | null>(null);
  const [footnoteEditError, setFootnoteEditError] = useState("");
  const inlineNotes = useMemo(() => value.includes("^[") ? inlineFootnotes(value) : [], [value]);
  const pendingNumbers = useMemo(
    () => pendingFootnotes.length > 0 ? footnoteNumbers(value) : new Map<string, number>(),
    [value, pendingFootnotes.length]
  );
  // Position of the floating table toolbar (relative to the shell), or null when
  // the caret is not inside a table.
  const [tableUi, setTableUi] = useState<{ top: number; left: number } | null>(null);
  // The frame drawn over the selected image, in shell coordinates, plus the
  // size readout shown while a handle is being dragged (GitHub #35).
  const [imageUi, setImageUi] = useState<
    { top: number; left: number; width: number; height: number; dragging: boolean } | null
  >(null);
  const selectedImageRef = useRef<HTMLImageElement | null>(null);
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

        if (!onLoadMention || chip.dataset.powerwikiMentionNamed) {
          continue;
        }
        chip.dataset.powerwikiMentionNamed = "loading";
        onLoadMention(id)
          .then((identity) => {
            chip.textContent = `@${identity.displayName}`;
            chip.title = identity.uniqueName ?? identity.displayName;
            chip.dataset.powerwikiMentionNamed = "1";
          })
          .catch(() => {
            // Leave the placeholder; the mention itself is still intact.
            delete chip.dataset.powerwikiMentionNamed;
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
      .use(looseHeadingsPlugin)
      .use(editableFootnotes)
      // Emoji shortcodes show as their character while editing, and the
      // editable variant keeps the shortcode on the element so Turndown can
      // write `:tada:` back out instead of the character (see wikiEmoji).
      .use(editableEmojiPlugin);
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

  function openFootnoteEditor(node: HTMLElement) {
    if (disabled) return;
    let source: string;
    try { source = decodeURIComponent(node.getAttribute(FOOTNOTE_SOURCE_ATTR) ?? ""); } catch { return; }
    const inline = source.startsWith("^[");
    const match = /^\[\^[^\]\s]+\]:[ \t]?/.exec(source);
    if (!inline && !match) return;
    setFootnoteEditError("");
    setEditingFootnote({ node, source, inline, text: inline ? source.slice(2, -1) : source.slice(match![0].length).replace(/^ {4}/gm, "") });
  }

  function saveFootnoteEdit() {
    const edit = editingFootnote;
    const editor = editorRef.current;
    if (!edit || !editor || !editor.contains(edit.node)) return;
    const prefix = /^\[\^[^\]\s]+\]:[ \t]?/.exec(edit.source)?.[0] ?? "";
    const originalText = edit.inline ? edit.source.slice(2, -1) : edit.source.slice(prefix.length).replace(/^ {4}/gm, "");
    if (edit.text === originalText) { setEditingFootnote(null); return; }
    const source = edit.inline ? `^[${edit.text}]` : prefix + edit.text.replace(/\r?\n/g, "\n    ");
    if (edit.inline && (inlineFootnotes(source)[0]?.content !== edit.text || source.includes("\n"))) {
      setFootnoteEditError("Inline footnotes must fit on one line and use balanced brackets.");
      return;
    }
    const template = document.createElement("template");
    template.innerHTML = edit.inline ? renderer.renderInline(source) : renderer.render(source);
    const replacement = template.content.querySelector(edit.inline ? ".wiki-richtext-footnote-ref" : ".wiki-richtext-footnote");
    if (!replacement) { setFootnoteEditError("Could not update this footnote."); return; }
    edit.node.replaceWith(replacement);
    syncMarkdownFromDom();
    setEditingFootnote(null);
    editor.focus();
  }

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    if (lastAppliedValueRef.current === value) {
      return;
    }

    editor.innerHTML = value.trim().length > 0 ? renderer.render(value) : "<p><br></p>";
    editHistoryRef.current = { past: [], current: { html: editor.innerHTML, selection: null }, future: [], typing: false };
    setPendingFootnotes([]);
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

  /** Redraws the resize frame over the selected image, or hides it. */
  const updateImageFrame = useCallback((dragging = false) => {
    const image = selectedImageRef.current;
    const editor = editorRef.current;
    const shell = shellRef.current;
    if (!image || !editor || !shell || !editor.contains(image)) {
      setImageUi(null);
      return;
    }

    const shellRect = shell.getBoundingClientRect();
    const rect = image.getBoundingClientRect();
    setImageUi({
      top: rect.top - shellRect.top,
      left: rect.left - shellRect.left,
      width: rect.width,
      height: rect.height,
      dragging,
    });
  }, []);

  /**
   * Runs a handle drag. Pointer capture keeps the gesture alive when the
   * pointer leaves the small handle, and the size is written to the image's
   * width/height attributes rather than a style, because attributes are what
   * Turndown reads back out into `=WxH`.
   */
  const startImageResize = useCallback(
    (event: React.PointerEvent<HTMLSpanElement>, handle: ResizeHandle) => {
      const image = selectedImageRef.current;
      if (!image || disabled) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      const rect = image.getBoundingClientRect();
      const start: ImageSize = { width: rect.width, height: rect.height };
      const startX = event.clientX;
      const startY = event.clientY;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      const onMove = (move: PointerEvent) => {
        const size = resizedSize(start, handle, move.clientX - startX, move.clientY - startY);
        image.setAttribute("width", String(size.width));
        image.setAttribute("height", String(size.height));
        updateImageFrame(true);
      };

      const onUp = () => {
        target.releasePointerCapture(event.pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        updateImageFrame(false);
        // A resize fires no input event, so the draft would keep the old size
        // until the next keystroke - and a save in between would lose it.
        syncMarkdownFromDom();
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
    },
    [disabled, updateImageFrame]
  );

  function recordEdit(editor: HTMLElement, typing = false) {
    const history = editHistoryRef.current;
    if (!history || restoringHistoryRef.current) return;
    const next = editor.innerHTML;
    if (next === history.current.html) return;
    if (!typing || !history.typing || history.future.length) history.past.push(history.current);
    if (history.past.length > 100) history.past.shift();
    while (history.past.length > 1 && history.past.reduce((sum, entry) => sum + entry.html.length, next.length) > MAX_HISTORY_CHARS) history.past.shift();
    history.current = { html: next, selection: captureSelection(editor) };
    history.future = [];
    history.typing = typing;
  }

  function syncMarkdownFromDom() {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const markdown = richTextMarkdown(editor, turndown);
    updateEditableFootnoteNumbers(editor, markdown);
    recordEdit(editor);
    setPendingFootnotes(pendingFootnoteDefinitions(editor));
    lastAppliedValueRef.current = markdown;
    onChange(markdown);
  }

  historyActionRef.current = (undo: boolean) => {
    const editor = editorRef.current;
    const history = editHistoryRef.current;
    if (!editor || !history) return;
    const source = undo ? history.past : history.future;
    if (!source.length) return;
    (undo ? history.future : history.past).push(history.current);
    history.current = source.pop()!;
    history.typing = false;
    editor.innerHTML = history.current.html;
    swapAttachmentImages(editor);
    for (const chip of Array.from(editor.querySelectorAll<HTMLElement>('[data-powerwiki-mention-named="loading"]'))) delete chip.dataset.powerwikiMentionNamed;
    nameMentions(editor);
    restoreSelection(editor, history.current.selection);
    restoringHistoryRef.current = true;
    try { syncMarkdownFromDom(); } finally { restoringHistoryRef.current = false; }
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    // Undo can also come from the browser menu, not just a keyboard shortcut.
    const beforeInput = (event: InputEvent) => {
      if (event.inputType !== "historyUndo" && event.inputType !== "historyRedo") {
        const history = editHistoryRef.current;
        if (history) {
          // Async image and mention enrichment can alter presentation between
          // edits without producing an input event.
          history.current.html = editor.innerHTML;
          history.current.selection = captureSelection(editor);
        }
        return;
      }
      event.preventDefault();
      historyActionRef.current(event.inputType === "historyUndo");
    };
    editor.addEventListener("beforeinput", beforeInput);
    return () => editor.removeEventListener("beforeinput", beforeInput);
  }, []);

  useEffect(() => {
    if (!footnoteOpen) return;
    const close = (event: MouseEvent) => {
      if (!footnoteMenuRef.current?.contains(event.target as Node)) setFootnoteOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setFootnoteOpen(false); editorRef.current?.focus(); }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [footnoteOpen]);

  async function insertFootnote(existingLabel?: string) {
    const editor = editorRef.current;
    if (!editor || disabled) return;
    const savedSelection = lastSelectionRef.current?.cloneRange();
    const text = existingLabel ? undefined : onPrompt ? await onPrompt("Footnote text", "") : "Footnote text";
    if (!existingLabel && text === undefined) { setFootnoteOpen(false); return; }
    const markdown = richTextMarkdown(editor, turndown);
    const label = existingLabel ?? nextFootnoteLabel(markdown);
    const selection = document.getSelection();
    if (!selection) return;
    const range = savedSelection && editor.contains(savedSelection.endContainer) ? savedSelection : document.createRange();
    if (range !== savedSelection) range.selectNodeContents(editor);
    range.collapse(false);
    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    const marker = document.createElement("sup");
    const markerSource = `[^${label}]`;
    marker.setAttribute(FOOTNOTE_SOURCE_ATTR, encodeURIComponent(markerSource));
    marker.contentEditable = "false";
    marker.className = "wiki-richtext-footnote-ref";
    marker.textContent = `[${label}]`;
    if (!existingLabel) {
      const noteSource = `[^${label}]: ${(text ?? "").replace(/\r?\n/g, "\n    ")}`;
      marker.setAttribute(FOOTNOTE_PENDING_DEFINITION_ATTR, encodeURIComponent(noteSource));
      marker.title = text ?? "";
    } else {
      // A newly inserted definition travels with every reference until the
      // editor is reopened, so deleting one of several references keeps it.
      for (const prior of Array.from(editor.querySelectorAll<HTMLElement>(`[${FOOTNOTE_PENDING_DEFINITION_ATTR}]`))) {
        const encoded = prior.getAttribute(FOOTNOTE_PENDING_DEFINITION_ATTR) ?? "";
        try {
          if (decodeURIComponent(encoded).startsWith(`[^${label}]:`)) {
            marker.setAttribute(FOOTNOTE_PENDING_DEFINITION_ATTR, encoded);
            marker.title = prior.title;
            break;
          }
        } catch { /* Ignore a malformed pasted attribute. */ }
      }
    }
    if (!document.execCommand("insertHTML", false, marker.outerHTML)) {
      setFootnoteOpen(false);
      return;
    }
    setFootnoteOpen(false);
    syncMarkdownFromDom();
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
      const selection = document.getSelection();
      if (selection?.rangeCount && editor.contains(selection.getRangeAt(0).endContainer)) {
        lastSelectionRef.current = selection.getRangeAt(0).cloneRange();
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
    const reposition = () => {
      updateTableToolbar();
      updateImageFrame();
    };
    editor?.addEventListener("scroll", reposition);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      editor?.removeEventListener("scroll", reposition);
      window.removeEventListener("resize", reposition);
    };
  }, [updateTableToolbar, updateImageFrame]);

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
        <div className="wiki-format-linkpicker" ref={footnoteMenuRef}>
          <button aria-expanded={footnoteOpen} aria-haspopup="menu" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => setFootnoteOpen((open) => !open)} title="Insert a footnote" type="button">Footnote ▾</button>
          {footnoteOpen ? (
            <div className="wiki-format-linkpicker-popover" role="menu" aria-label="Footnotes">
              <button role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => void insertFootnote()} type="button">New footnote</button>
              {footnoteLabels(value).map((label) => (
                <button key={label} role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => void insertFootnote(label)} type="button">Reference {label}</button>
              ))}
            </div>
          ) : null}
        </div>
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
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest(".wiki-richtext-footnote-edit")) {
            const note = target.closest<HTMLElement>(`.wiki-richtext-footnote[${FOOTNOTE_SOURCE_ATTR}]`);
            if (note) openFootnoteEditor(note);
          }
        }}
        onPointerDown={(event) => {
          if (editHistoryRef.current) editHistoryRef.current.typing = false;
          // Clicking an image selects it for resizing; clicking anything else
          // puts the frame away. The handles live outside this element, so a
          // drag on one never reaches here and never deselects.
          const target = event.target;
          selectedImageRef.current = target instanceof HTMLImageElement ? target : null;
          updateImageFrame();
        }}
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
        onCompositionStart={() => { if (editHistoryRef.current) editHistoryRef.current.typing = false; }}
        onCompositionEnd={() => { if (editHistoryRef.current) editHistoryRef.current.typing = false; }}
        onInput={(event) => {
          const markdown = richTextMarkdown(event.currentTarget, turndown);
          updateEditableFootnoteNumbers(event.currentTarget, markdown);
          const inputType = (event.nativeEvent as InputEvent).inputType;
          recordEdit(event.currentTarget, inputType === "insertText" || inputType === "insertCompositionText");
          setPendingFootnotes(pendingFootnoteDefinitions(event.currentTarget));
          lastAppliedValueRef.current = markdown;
          onChange(markdown);
          refreshMentionPicker();
        }}
        onKeyDown={(event) => {
          const history = editHistoryRef.current;
          const undo = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "z" && !event.shiftKey;
          const redo = (event.ctrlKey || event.metaKey) && !event.altKey && (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey));
          if (history && (undo || redo)) {
            event.preventDefault();
            historyActionRef.current(undo);
            return;
          }
          if (history && (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End")) history.typing = false;
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
      {pendingFootnotes.length > 0 ? (
        <div className={editorRef.current?.querySelector(".wiki-richtext-footnote") ? "wiki-richtext-pending-footnotes has-existing-footnotes" : "wiki-richtext-pending-footnotes"} aria-label="New footnotes">
          {pendingFootnotes.map((definition) => <div key={definition}>{definition.replace(/^\[\^([^\]\s]+)\]:[ \t]?/, (_match, label: string) => `[${pendingNumbers.get(label) ?? label}] `)}</div>)}
        </div>
      ) : null}
      {inlineNotes.length > 0 ? (
        <div className={editorRef.current?.querySelector(".wiki-richtext-footnote") || pendingFootnotes.length ? "wiki-richtext-pending-footnotes has-existing-footnotes" : "wiki-richtext-pending-footnotes"} aria-label="Inline footnotes">
          {inlineNotes.map((note, index) => <div key={index}>[{note.number}] <span dangerouslySetInnerHTML={{ __html: renderer.renderInline(note.content) }} /> <button className="wiki-richtext-footnote-edit" type="button" disabled={disabled} onClick={() => {
            const nodes = Array.from(editorRef.current?.querySelectorAll<HTMLElement>(`.wiki-richtext-footnote-ref[${FOOTNOTE_SOURCE_ATTR}]`) ?? []).filter((node) => {
              try { return decodeURIComponent(node.getAttribute(FOOTNOTE_SOURCE_ATTR) ?? "").startsWith("^["); } catch { return false; }
            });
            if (nodes[index]) openFootnoteEditor(nodes[index]);
          }}>Edit</button></div>)}
        </div>
      ) : null}
      {editingFootnote ? (
        <div className="wiki-dialog-overlay" role="presentation">
          <div className="wiki-dialog" role="dialog" aria-modal="true" aria-labelledby="wiki-footnote-edit-title">
            <h2 id="wiki-footnote-edit-title" className="wiki-dialog-title">Edit footnote</h2>
            <label>Footnote text (Markdown)<textarea autoFocus value={editingFootnote.text} onChange={(event) => setEditingFootnote({ ...editingFootnote, text: event.target.value })} rows={6} style={{ display: "block", width: "100%" }} /></label>
            {footnoteEditError ? <p role="alert">{footnoteEditError}</p> : null}
            <div className="wiki-dialog-actions"><button className="wiki-dialog-secondary" type="button" onClick={() => setEditingFootnote(null)}>Cancel</button><button className="wiki-dialog-primary" type="button" onClick={saveFootnoteEdit}>Apply</button></div>
          </div>
        </div>
      ) : null}
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
      {imageUi ? (
        <div
          className="wiki-richtext-image-frame"
          style={{ left: imageUi.left, top: imageUi.top, width: imageUi.width, height: imageUi.height }}
        >
          {IMAGE_HANDLES.map((handle) => (
            <span
              aria-label={`Resize image (${handle})`}
              className={`wiki-richtext-image-handle wiki-richtext-image-handle-${handle}`}
              key={handle}
              onPointerDown={(event) => startImageResize(event, handle)}
              role="presentation"
            />
          ))}
          {imageUi.dragging ? (
            <span className="wiki-richtext-image-size" role="status">
              {Math.round(imageUi.width)} × {Math.round(imageUi.height)}
            </span>
          ) : null}
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
