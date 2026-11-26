import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WikiRichTextEditor } from "./WikiRichTextEditor";

it("restores authenticated images and resolved mentions after undo", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const loadImage = vi.fn().mockResolvedValue("blob:test-image");
  const loadMention = vi.fn().mockResolvedValue({ id: "12345678-1234-1234-1234-123456789abc", displayName: "Test User" });
  try {
    await act(async () => {
      root.render(<WikiRichTextEditor value={'![image](/.attachments/image.png) @<12345678-1234-1234-1234-123456789abc>'} onChange={() => {}} onResolveImageSrc={() => "https://example.test/image"} onLoadImage={loadImage} onLoadMention={loadMention} />);
    });
    const editor = container.querySelector<HTMLElement>(".wiki-richtext-editor")!;
    expect(editor.querySelector("img")?.getAttribute("src")).toBe("blob:test-image");
    expect(editor.textContent).toContain("@Test User");
    await act(async () => {
      editor.insertAdjacentHTML("beforeend", "<p>Changed</p>");
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertParagraph" }));
      editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ctrlKey: true, key: "z" }));
    });
    expect(editor.textContent).not.toContain("Changed");
    expect(editor.querySelector("img")?.getAttribute("src")).toBe("blob:test-image");
    expect(editor.textContent).toContain("@Test User");
  } finally {
    act(() => root.unmount());
    revoke.mockRestore();
    container.remove();
  }
});
