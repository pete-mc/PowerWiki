import { useEffect, useMemo, useRef } from "react";

import { createMarkdownRenderer } from "./createMarkdownRenderer";
import { renderMermaidDiagrams } from "./renderMermaidDiagrams";
import { sanitizeRenderedHtml } from "./sanitizeRenderedHtml";

interface MarkdownPreviewProps {
  readonly markdown: string;
}

const markdownRenderer = createMarkdownRenderer();

export function MarkdownPreview({ markdown }: MarkdownPreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const html = useMemo(
    () => sanitizeRenderedHtml(markdownRenderer.render(markdown)),
    [markdown]
  );

  useEffect(() => {
    if (!previewRef.current) {
      return;
    }

    void renderMermaidDiagrams(previewRef.current);
  }, [html]);

  return (
    <div
      className="markdown-preview"
      dangerouslySetInnerHTML={{ __html: html }}
      ref={previewRef}
    />
  );
}

