import { useEffect, useRef, useState } from "react";

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

let monacoLoadPromise: Promise<MonacoApi> | undefined;

export function WikiPageEditor({ disabled, onChange, value }: WikiPageEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();

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

  return (
    <div className="wiki-page-editor-wrap">
      {isLoading ? <div className="wiki-page-editor-status">Loading editor.</div> : null}
      {loadError ? <div className="wiki-page-editor-status wiki-page-editor-status-error">{loadError}</div> : null}
      <div className="wiki-page-editor" ref={containerRef} />
    </div>
  );
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
