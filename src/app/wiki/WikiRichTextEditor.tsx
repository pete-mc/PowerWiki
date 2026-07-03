import { useEffect, useMemo, useRef } from "react";

import MarkdownIt from "markdown-it";
import TurndownService from "turndown";

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

  return (
    <div className="wiki-richtext-shell">
      <div
        aria-label="Rich text markdown editor"
        className="wiki-richtext-editor"
        contentEditable={!disabled}
        onInput={(event) => {
          const html = event.currentTarget.innerHTML;
          const markdown = turndown.turndown(html);
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
