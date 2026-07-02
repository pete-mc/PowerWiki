import { useCallback, useEffect, useRef, useState } from "react";

import type * as Monaco from "monaco-editor";

interface WikiPageEditorProps {
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
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

interface MermaidSnippet {
  readonly label: string;
  readonly code: string;
}

// Compact, valid starter diagrams for each Mermaid type PowerWiki renders.
// Inserted as fenced ```mermaid blocks so they round-trip through the standard
// Azure DevOps Wiki as portable Markdown.
const MERMAID_SNIPPETS: readonly MermaidSnippet[] = [
  {
    label: "Flowchart",
    code: [
      "flowchart TD",
      "    A[Start] --> B{Decision}",
      "    B -->|Yes| C[Do this]",
      "    B -->|No| D[Do that]",
      "    C --> E[End]",
      "    D --> E",
    ].join("\n"),
  },
  {
    label: "Sequence diagram",
    code: [
      "sequenceDiagram",
      "    participant A as Alice",
      "    participant B as Bob",
      "    A->>B: Hello Bob, how are you?",
      "    B-->>A: Great, thanks!",
    ].join("\n"),
  },
  {
    label: "Class diagram",
    code: [
      "classDiagram",
      "    class Animal {",
      "        +String name",
      "        +move()",
      "    }",
      "    Animal <|-- Dog",
      "    Animal <|-- Cat",
    ].join("\n"),
  },
  {
    label: "State diagram",
    code: [
      "stateDiagram-v2",
      "    [*] --> Idle",
      "    Idle --> Running: start",
      "    Running --> Idle: stop",
      "    Running --> [*]",
    ].join("\n"),
  },
  {
    label: "Entity relationship",
    code: [
      "erDiagram",
      "    CUSTOMER ||--o{ ORDER : places",
      "    ORDER ||--|{ LINE_ITEM : contains",
      "    CUSTOMER }|..|{ ADDRESS : uses",
    ].join("\n"),
  },
  {
    label: "User journey",
    code: [
      "journey",
      "    title My working day",
      "    section Go to work",
      "      Make tea: 5: Me",
      "      Commute: 3: Me",
      "    section Work",
      "      Do work: 1: Me",
    ].join("\n"),
  },
  {
    label: "Gantt chart",
    code: [
      "gantt",
      "    title Project schedule",
      "    dateFormat YYYY-MM-DD",
      "    section Planning",
      "      Research      :a1, 2024-01-01, 7d",
      "      Design        :after a1, 5d",
      "    section Build",
      "      Implementation:after a1, 10d",
    ].join("\n"),
  },
  {
    label: "Pie chart",
    code: [
      "pie title Pets adopted by volunteers",
      '    "Dogs" : 45',
      '    "Cats" : 30',
      '    "Birds" : 25',
    ].join("\n"),
  },
  {
    label: "Quadrant chart",
    code: [
      "quadrantChart",
      "    title Reach and engagement",
      "    x-axis Low Reach --> High Reach",
      "    y-axis Low Engagement --> High Engagement",
      "    Campaign A: [0.3, 0.6]",
      "    Campaign B: [0.7, 0.4]",
    ].join("\n"),
  },
  {
    label: "Mindmap",
    code: [
      "mindmap",
      "  root((PowerWiki))",
      "    Rendering",
      "      Markdown",
      "      Mermaid",
      "    Editing",
      "      Monaco",
    ].join("\n"),
  },
  {
    label: "Timeline",
    code: [
      "timeline",
      "    title Product history",
      "    2021 : Idea",
      "    2022 : Prototype",
      "    2023 : Launch",
    ].join("\n"),
  },
  {
    label: "Git graph",
    code: [
      "gitGraph",
      "    commit",
      "    branch develop",
      "    checkout develop",
      "    commit",
      "    checkout main",
      "    merge develop",
    ].join("\n"),
  },
];

let monacoLoadPromise: Promise<MonacoApi> | undefined;

export function WikiPageEditor({ disabled, onChange, value }: WikiPageEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | undefined>(undefined);
  const monacoRef = useRef<MonacoApi | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  const mermaidRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [mermaidOpen, setMermaidOpen] = useState(false);

  const formattingDisabled = Boolean(disabled) || isLoading || Boolean(loadError);

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
          theme: "vs",
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

        return () => {
          resizeObserver.disconnect();
          modelDisposable.dispose();
          editor.dispose();
          editorRef.current = undefined;
          monacoRef.current = undefined;
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
          <button className="wiki-format-button bold" disabled={formattingDisabled} onMouseDown={keepEditorFocus} onClick={() => applyWrap("**", "**", "bold text")} title="Bold" type="button">B</button>
          <button className="wiki-format-button italic" disabled={formattingDisabled} onMouseDown={keepEditorFocus} onClick={() => applyWrap("*", "*", "italic text")} title="Italic" type="button">I</button>
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
          <button className="wiki-format-button" disabled={formattingDisabled} onMouseDown={keepEditorFocus} onClick={applyLink} title="Link" type="button">Link</button>
        </div>
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
