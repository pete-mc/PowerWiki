import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type * as Monaco from "monaco-editor";

import { resolveThemeMode, useThemeMode } from "../themeMode";
import {
  attachmentMarkdown,
  dragHasFiles,
  filesFromDataTransfer,
  isImageFile,
  type UploadAttachment,
} from "../../wiki/attachmentUpload";
import { MERMAID_SNIPPETS } from "./mermaidSnippets";
import { registerSlashCommands } from "./slashCommands";

/** A wiki page offered by the page-link picker. */
export interface WikiPageLink {
  readonly path: string;
  readonly title: string;
}

interface WikiPageEditorProps {
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
  /** Uploads a pasted/dropped/picked file and returns its wiki reference. */
  readonly onUploadAttachment?: UploadAttachment;
  /** Wiki pages the page-link picker can insert links to. */
  readonly pages?: readonly WikiPageLink[];
  readonly value: string;
}

type MonacoApi = typeof Monaco;

interface MonacoAmdRequire {
  (dependencies: readonly string[], onLoad: () => void, onError?: (error: unknown) => void): void;
  config(options: { paths: { vs: string } }): void;
}

declare global {
  interface Window {
    monaco?: MonacoApi;
    require?: MonacoAmdRequire;
  }
}


let monacoLoadPromise: Promise<MonacoApi> | undefined;

export function WikiPageEditor({ disabled, onChange, onUploadAttachment, pages, value }: WikiPageEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | undefined>(undefined);
  const monacoRef = useRef<MonacoApi | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  const mermaidRef = useRef<HTMLDivElement>(null);
  const linkPickerRef = useRef<HTMLDivElement>(null);
  const linkSearchRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [mermaidOpen, setMermaidOpen] = useState(false);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const [editorReady, setEditorReady] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadError, setUploadError] = useState<string>();
  const themeMode = useThemeMode();

  const formattingDisabled = Boolean(disabled) || isLoading || Boolean(loadError);
  const uploadDisabled = formattingDisabled || !onUploadAttachment;

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let disposed = false;

    async function createEditor(): Promise<(() => void) | undefined> {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      try {
        const monaco = await loadMonaco();
        if (disposed) {
          return;
        }

        monacoRef.current = monaco;
        registerSlashCommands(monaco);
        const editor = monaco.editor.create(container, {
          automaticLayout: false,
          fontFamily: 'Consolas, "Courier New", monospace',
          fontSize: 14,
          language: "markdown",
          minimap: { enabled: false },
          padding: { top: 12, bottom: 12 },
          readOnly: disabled,
          renderWhitespace: "selection",
          scrollBeyondLastLine: false,
          tabSize: 2,
          theme: resolveThemeMode() === "dark" ? "vs-dark" : "vs",
          value,
          wordWrap: "on",
        });
        editorRef.current = editor;

        const modelDisposable = editor.onDidChangeModelContent(() => {
          onChangeRef.current(editor.getValue());
        });
        const resizeObserver = new ResizeObserver(() => {
          editor.layout();
        });
        resizeObserver.observe(container);
        setIsLoading(false);
        setEditorReady(true);

        return () => {
          resizeObserver.disconnect();
          modelDisposable.dispose();
          editor.dispose();
          editorRef.current = undefined;
          monacoRef.current = undefined;
          setEditorReady(false);
        };
      } catch (error: unknown) {
        if (!disposed) {
          setIsLoading(false);
          setLoadError(formatEditorLoadError(error));
        }
      }

      return undefined;
    }

    let cleanup: (() => void) | undefined;
    void createEditor().then((disposeEditor) => {
      cleanup = disposeEditor;
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      editor.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: disabled });
  }, [disabled]);

  // Follow the Azure DevOps theme. setTheme is global to the Monaco instance, so
  // it applies once the editor has loaded and on every later theme switch.
  useEffect(() => {
    monacoRef.current?.editor.setTheme(themeMode === "dark" ? "vs-dark" : "vs");
  }, [themeMode]);

  // Close the Mermaid menu on an outside click or Escape.
  useEffect(() => {
    if (!mermaidOpen) {
      return;
    }

    function onPointerDown(event: MouseEvent) {
      if (mermaidRef.current && !mermaidRef.current.contains(event.target as Node)) {
        setMermaidOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMermaidOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mermaidOpen]);

  // Wraps the current selection (or a placeholder) with the given delimiters and
  // leaves the inner text selected so the user can keep typing.
  const applyWrap = useCallback((before: string, after: string, placeholder: string) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) {
      return;
    }

    const model = editor.getModel();
    const selection = editor.getSelection();
    if (!model || !selection) {
      return;
    }

    const selected = model.getValueInRange(selection);
    const inner = selected || placeholder;
    editor.executeEdits("wiki-format", [
      { range: selection, text: `${before}${inner}${after}`, forceMoveMarkers: true },
    ]);

    const startLine = selection.startLineNumber;
    const startColumn = selection.startColumn + before.length;
    const innerLines = inner.split("\n");
    const endLine = startLine + innerLines.length - 1;
    const endColumn =
      innerLines.length === 1
        ? startColumn + inner.length
        : (innerLines.at(-1)?.length ?? 0) + 1;
    editor.setSelection(new monaco.Selection(startLine, startColumn, endLine, endColumn));
    editor.focus();
  }, []);

  // Applies a per-line transform to every line the selection touches.
  const transformLines = useCallback(
    (transform: (lineContent: string, ordinal: number) => string) => {
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      if (!editor || !monaco) {
        return;
      }

      const model = editor.getModel();
      const selection = editor.getSelection();
      if (!model || !selection) {
        return;
      }

      let endLine = selection.endLineNumber;
      if (endLine > selection.startLineNumber && selection.endColumn === 1) {
        endLine -= 1;
      }

      const edits: Monaco.editor.IIdentifiedSingleEditOperation[] = [];
      let ordinal = 0;
      for (let line = selection.startLineNumber; line <= endLine; line += 1) {
        const content = model.getLineContent(line);
        edits.push({
          range: new monaco.Range(line, 1, line, content.length + 1),
          text: transform(content, ordinal),
        });
        ordinal += 1;
      }

      if (edits.length > 0) {
        editor.executeEdits("wiki-format", edits);
      }
      editor.focus();
    },
    []
  );

  // Wraps the selected lines in a fenced code block on their own lines.
  const applyCodeBlock = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) {
      return;
    }

    const model = editor.getModel();
    const selection = editor.getSelection();
    if (!model || !selection) {
      return;
    }

    const startLine = selection.startLineNumber;
    let endLine = selection.endLineNumber;
    if (endLine > startLine && selection.endColumn === 1) {
      endLine -= 1;
    }

    const range = new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine));
    const selected = model.getValueInRange(range) || "code";
    editor.executeEdits("wiki-format", [
      { range, text: `\`\`\`\n${selected}\n\`\`\``, forceMoveMarkers: true },
    ]);
    editor.focus();
  }, []);

  // Inserts a [text](url) link and selects the url placeholder for a single-line
  // selection so it can be replaced immediately.
  const applyLink = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) {
      return;
    }

    const model = editor.getModel();
    const selection = editor.getSelection();
    if (!model || !selection) {
      return;
    }

    const label = model.getValueInRange(selection) || "link text";
    editor.executeEdits("wiki-format", [
      { range: selection, text: `[${label}](url)`, forceMoveMarkers: true },
    ]);

    if (!label.includes("\n")) {
      const urlColumn = selection.startColumn + 1 + label.length + 2;
      editor.setSelection(
        new monaco.Selection(selection.startLineNumber, urlColumn, selection.startLineNumber, urlColumn + 3)
      );
    }
    editor.focus();
  }, []);

  // Inserts a fenced Mermaid block at the cursor, starting on its own line.
  const insertMermaid = useCallback((snippet: string) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) {
      return;
    }

    const selection = editor.getSelection();
    if (!selection) {
      return;
    }

    const leadingNewline = selection.startColumn === 1 ? "" : "\n";
    editor.executeEdits("wiki-format", [
      {
        range: selection,
        text: `${leadingNewline}\`\`\`mermaid\n${snippet}\n\`\`\`\n`,
        forceMoveMarkers: true,
      },
    ]);
    setMermaidOpen(false);
    editor.focus();
  }, []);

  // Inserts text at the current cursor, replacing any selection.
  const insertAtCursor = useCallback((text: string) => {
    const editor = editorRef.current;
    const selection = editor?.getSelection();
    if (!editor || !selection) {
      return;
    }

    editor.executeEdits("wiki-attach", [{ range: selection, text, forceMoveMarkers: true }]);
    editor.focus();
  }, []);

  // Inserts a Markdown link to another wiki page. Any current selection becomes
  // the link text; otherwise the page title is used.
  const insertPageLink = useCallback((page: WikiPageLink) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const selection = editor?.getSelection();
    if (!editor || !model || !selection) {
      return;
    }

    const label = model.getValueInRange(selection) || page.title;
    editor.executeEdits("wiki-format", [
      { range: selection, text: `[${label}](${encodeURI(page.path)})`, forceMoveMarkers: true },
    ]);
    setLinkPickerOpen(false);
    setLinkQuery("");
    editor.focus();
  }, []);

  // Binds the common Markdown formatting shortcuts once the editor exists.
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editorReady || !editor || !monaco) {
      return;
    }

    const { CtrlCmd } = monaco.KeyMod;
    const disposables = [
      editor.addAction({
        id: "powerwiki.bold",
        label: "PowerWiki: Bold",
        keybindings: [CtrlCmd | monaco.KeyCode.KeyB],
        run: () => applyWrap("**", "**", "bold text"),
      }),
      editor.addAction({
        id: "powerwiki.italic",
        label: "PowerWiki: Italic",
        keybindings: [CtrlCmd | monaco.KeyCode.KeyI],
        run: () => applyWrap("*", "*", "italic text"),
      }),
      editor.addAction({
        id: "powerwiki.link",
        label: "PowerWiki: Insert link",
        keybindings: [CtrlCmd | monaco.KeyCode.KeyK],
        run: () => applyLink(),
      }),
    ];
    return () => disposables.forEach((disposable) => disposable.dispose());
  }, [applyLink, applyWrap, editorReady]);

  const filteredPages = useMemo(() => {
    const all = pages ?? [];
    const query = linkQuery.trim().toLowerCase();
    const matches = query
      ? all.filter(
          (page) => page.title.toLowerCase().includes(query) || page.path.toLowerCase().includes(query)
        )
      : all;
    return matches.slice(0, 50);
  }, [linkQuery, pages]);

  // Close the page-link picker on an outside click or Escape, and focus its
  // search box when it opens.
  useEffect(() => {
    if (!linkPickerOpen) {
      setLinkQuery("");
      return;
    }

    linkSearchRef.current?.focus();

    function onPointerDown(event: MouseEvent) {
      if (linkPickerRef.current && !linkPickerRef.current.contains(event.target as Node)) {
        setLinkPickerOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setLinkPickerOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [linkPickerOpen]);

  // Uploads each file and inserts its Markdown reference at the cursor. Files
  // upload sequentially so their references keep a predictable order.
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
          insertAtCursor(attachmentMarkdown(result));
        } catch (error: unknown) {
          setUploadError(error instanceof Error ? error.message : "Upload failed.");
        } finally {
          setUploadCount((count) => count - 1);
        }
      }
    },
    [insertAtCursor, onUploadAttachment]
  );

  // Handles paste (images only, so plain text paste is untouched) and drop of
  // files onto the editor. Registered in the capture phase so it runs before
  // Monaco's own clipboard handling.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onUploadAttachment) {
      return;
    }

    const onPaste = (event: ClipboardEvent) => {
      const images = filesFromDataTransfer(event.clipboardData).filter(isImageFile);
      if (images.length === 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void uploadFiles(images);
    };
    const onDragOver = (event: DragEvent) => {
      if (dragHasFiles(event.dataTransfer)) {
        event.preventDefault();
      }
    };
    const onDrop = (event: DragEvent) => {
      const files = filesFromDataTransfer(event.dataTransfer);
      if (files.length === 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void uploadFiles(files);
    };

    container.addEventListener("paste", onPaste, true);
    container.addEventListener("dragover", onDragOver, true);
    container.addEventListener("drop", onDrop, true);
    return () => {
      container.removeEventListener("paste", onPaste, true);
      container.removeEventListener("dragover", onDragOver, true);
      container.removeEventListener("drop", onDrop, true);
    };
  }, [onUploadAttachment, uploadFiles]);

  const onFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files ? Array.from(event.target.files) : [];
      event.target.value = "";
      void uploadFiles(files);
    },
    [uploadFiles]
  );

  const heading = useCallback(
    (level: number) => transformLines((content) => toggleHeading(content, level)),
    [transformLines]
  );

  // Prevents the toolbar buttons from stealing focus, so the editor keeps its
  // selection highlighted while a formatting command runs.
  const keepEditorFocus = (event: React.MouseEvent) => {
    event.preventDefault();
  };

  return (
    <div className="wiki-page-editor-wrap">
      <div className="wiki-format-toolbar" role="toolbar" aria-label="Markdown formatting">
        <div className="wiki-format-group">
          <button className="wiki-format-button" disabled={formattingDisabled} onMouseDown={keepEditorFocus} onClick={() => heading(1)} title="Heading 1" type="button">H1</button>
          <button className="wiki-format-button" disabled={formattingDisabled} onMouseDown={keepEditorFocus} onClick={() => heading(2)} title="Heading 2" type="button">H2</button>
          <button className="wiki-format-button" disabled={formattingDisabled} onMouseDown={keepEditorFocus} onClick={() => heading(3)} title="Heading 3" type="button">H3</button>
        </div>
        <span className="wiki-format-sep" aria-hidden="true" />
        <div className="wiki-format-group">
          <button className="wiki-format-button bold" disabled={formattingDisabled} onMouseDown={keepEditorFocus} onClick={() => applyWrap("**", "**", "bold text")} title="Bold (Ctrl+B)" type="button">B</button>
          <button className="wiki-format-button italic" disabled={formattingDisabled} onMouseDown={keepEditorFocus} onClick={() => applyWrap("*", "*", "italic text")} title="Italic (Ctrl+I)" type="button">I</button>
          <button className="wiki-format-button code" disabled={formattingDisabled} onMouseDown={keepEditorFocus} onClick={() => applyWrap("`", "`", "code")} title="Inline code" type="button">{"</>"}</button>
        </div>
        <span className="wiki-format-sep" aria-hidden="true" />
        <div className="wiki-format-group">
          <button className="wiki-format-button" disabled={formattingDisabled} onMouseDown={keepEditorFocus} onClick={applyCodeBlock} title="Code block" type="button">Code block</button>
          <button className="wiki-format-button" disabled={formattingDisabled} onMouseDown={keepEditorFocus} onClick={() => transformLines(toggleQuote)} title="Quote" type="button">Quote</button>
        </div>
        <span className="wiki-format-sep" aria-hidden="true" />
        <div className="wiki-format-group">
          <button className="wiki-format-button" disabled={formattingDisabled} onMouseDown={keepEditorFocus} onClick={() => transformLines(toggleBullet)} title="Bulleted list" type="button">• List</button>
          <button className="wiki-format-button" disabled={formattingDisabled} onMouseDown={keepEditorFocus} onClick={() => transformLines(toggleOrdered)} title="Numbered list" type="button">1. List</button>
        </div>
        <span className="wiki-format-sep" aria-hidden="true" />
        <div className="wiki-format-group">
          <button className="wiki-format-button" disabled={formattingDisabled} onMouseDown={keepEditorFocus} onClick={applyLink} title="Link (Ctrl+K)" type="button">Link</button>
          <div className="wiki-format-linkpicker" ref={linkPickerRef}>
            <button
              aria-expanded={linkPickerOpen}
              aria-haspopup="menu"
              className="wiki-format-button"
              disabled={formattingDisabled || (pages?.length ?? 0) === 0}
              onMouseDown={keepEditorFocus}
              onClick={() => setLinkPickerOpen((open) => !open)}
              title="Insert a link to another wiki page"
              type="button"
            >
              Page link ▾
            </button>
            {linkPickerOpen ? (
              <div className="wiki-format-linkpicker-popover" role="menu">
                <input
                  className="wiki-format-linkpicker-search"
                  onChange={(event) => setLinkQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && filteredPages[0]) {
                      event.preventDefault();
                      insertPageLink(filteredPages[0]);
                    }
                  }}
                  placeholder="Search pages…"
                  ref={linkSearchRef}
                  type="text"
                  value={linkQuery}
                />
                <div className="wiki-format-linkpicker-list">
                  {filteredPages.length === 0 ? (
                    <div className="wiki-format-linkpicker-empty">No pages found.</div>
                  ) : (
                    filteredPages.map((page) => (
                      <button
                        className="wiki-format-linkpicker-item"
                        key={page.path}
                        onClick={() => insertPageLink(page)}
                        onMouseDown={keepEditorFocus}
                        role="menuitem"
                        title={page.path}
                        type="button"
                      >
                        <span className="wiki-format-linkpicker-title">{page.title}</span>
                        <span className="wiki-format-linkpicker-path">{page.path}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <button
            className="wiki-format-button"
            disabled={uploadDisabled || uploadCount > 0}
            onMouseDown={keepEditorFocus}
            onClick={() => fileInputRef.current?.click()}
            title="Insert an image or file (or paste/drop into the editor)"
            type="button"
          >
            Image
          </button>
          <input
            accept="image/*"
            hidden
            multiple
            onChange={onFileInputChange}
            ref={fileInputRef}
            type="file"
          />
        </div>
        {uploadCount > 0 ? <span className="wiki-format-status" role="status">Uploading…</span> : null}
        {uploadError ? <span className="wiki-format-status wiki-format-status-error" role="alert">{uploadError}</span> : null}
        <span className="wiki-format-hint" aria-hidden="true">Type <kbd>/</kbd> for commands</span>
        <div className="wiki-format-mermaid" ref={mermaidRef}>
          <button
            aria-expanded={mermaidOpen}
            aria-haspopup="menu"
            className="wiki-format-button"
            disabled={formattingDisabled}
            onMouseDown={keepEditorFocus}
            onClick={() => setMermaidOpen((open) => !open)}
            title="Insert a Mermaid diagram"
            type="button"
          >
            Mermaid ▾
          </button>
          {mermaidOpen ? (
            <div className="wiki-format-mermaid-popover" role="menu">
              {MERMAID_SNIPPETS.map((snippet) => (
                <button
                  key={snippet.label}
                  onMouseDown={keepEditorFocus}
                  onClick={() => insertMermaid(snippet.code)}
                  role="menuitem"
                  type="button"
                >
                  {snippet.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {isLoading ? <div className="wiki-page-editor-status">Loading editor.</div> : null}
      {loadError ? <div className="wiki-page-editor-status wiki-page-editor-status-error">{loadError}</div> : null}
      <div className="wiki-page-editor" ref={containerRef} />
    </div>
  );
}

function toggleHeading(content: string, level: number): string {
  const match = content.match(/^(#{1,6})\s+(.*)$/);
  const body = match ? match[2] : content;
  const currentLevel = match ? match[1].length : 0;
  if (currentLevel === level) {
    return body;
  }
  return `${"#".repeat(level)} ${body}`;
}

function toggleBullet(content: string): string {
  if (/^\s*-\s+/.test(content)) {
    return content.replace(/^(\s*)-\s+/, "$1");
  }
  return `- ${content.replace(/^(\s*)\d+\.\s+/, "$1")}`;
}

function toggleOrdered(content: string, ordinal: number): string {
  if (/^\s*\d+\.\s+/.test(content)) {
    return content.replace(/^(\s*)\d+\.\s+/, "$1");
  }
  return `${ordinal + 1}. ${content.replace(/^(\s*)-\s+/, "$1")}`;
}

function toggleQuote(content: string): string {
  return /^>\s?/.test(content) ? content.replace(/^>\s?/, "") : `> ${content}`;
}

function loadMonaco(): Promise<MonacoApi> {
  if (window.monaco) {
    return Promise.resolve(window.monaco);
  }

  monacoLoadPromise ??= new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>("script[data-powerwiki-monaco-loader='true']");
    if (existingScript && window.require) {
      configureAndLoadMonaco(resolve, reject);
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.dataset.powerwikiMonacoLoader = "true";
    script.src = "vs/loader.js";
    script.onload = () => configureAndLoadMonaco(resolve, reject);
    script.onerror = () => reject(new Error("Unable to load Monaco editor assets."));
    document.head.appendChild(script);
  });

  return monacoLoadPromise;
}

function configureAndLoadMonaco(resolve: (monaco: MonacoApi) => void, reject: (error: unknown) => void): void {
  if (!window.require) {
    reject(new Error("Monaco loader did not initialize."));
    return;
  }

  window.require.config({ paths: { vs: "vs" } });
  window.require(["vs/editor/editor.main"], () => {
    if (window.monaco) {
      resolve(window.monaco);
      return;
    }

    reject(new Error("Monaco editor did not initialize."));
  }, reject);
}

function formatEditorLoadError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to load Monaco editor.";
}
