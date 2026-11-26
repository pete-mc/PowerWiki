// What the rich text editor writes back to the wiki file.
//
// A save from WYSIWYG mode replaces the page with whatever Turndown makes of the
// editor's DOM, so a missing rule is not a rendering glitch — it is the stored
// Markdown losing something the author never touched.

import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";

import { MENTION_ATTR } from "../../rendering/adoMentionsPlugin";
import { EMOJI_ATTR } from "../../rendering/emojiPlugin";
import { createRichTextTurndown, richTextMarkdown } from "./richTextTurndown";
import { editableFootnotes, FOOTNOTE_PENDING_DEFINITION_ATTR, FOOTNOTE_SOURCE_ATTR, updateEditableFootnoteNumbers } from "./editableFootnotes";

const ADA = "a502d9c7-0cbd-45de-9b3f-1c2d3e4f5a6b";
const GRACE = "b613e0d8-1dce-46ef-ac40-2d3e4f5a6b7c";

const turndown = createRichTextTurndown();
const footnoteRenderer = new MarkdownIt({ html: false }).use(editableFootnotes);
const mentionChip = (id: string, name: string) =>
  `<span class="powerwiki-mention" ${MENTION_ATTR}="${id}">@${name}</span>`;

describe("footnotes", () => {
  it("shows readable references and formatted notes while preserving their source", () => {
    const source = "Text[^detail] and again[^detail].\n\n[^detail]: A **bold** note.";
    const editor = document.createElement("div");
    editor.innerHTML = footnoteRenderer.render(source);
    expect([...editor.querySelectorAll(".wiki-richtext-footnote-ref")].map((node) => node.textContent)).toEqual(["[1]", "[1:1]"]);
    expect(editor.querySelector(".wiki-richtext-footnote strong")?.textContent).toBe("bold");
    expect(turndown.turndown(editor.innerHTML)).toBe(source);
  });
  it("renumbers named footnotes when their reference order changes", () => {
    const original = "First[^a] second[^b].\n\n[^a]: A.\n\n[^b]: B.";
    const editor = document.createElement("div");
    editor.innerHTML = footnoteRenderer.render(original);
    updateEditableFootnoteNumbers(editor, "First[^b] second[^a].\n\n[^a]: A.\n\n[^b]: B.");
    expect([...editor.querySelectorAll(".wiki-richtext-footnote-ref")].map((node) => node.textContent)).toEqual(["[2]", "[1]"]);
    expect([...editor.querySelectorAll(".wiki-richtext-footnote-label")].map((node) => node.textContent)).toEqual(["[2]", "[1]"]);
    expect(turndown.turndown(editor.innerHTML)).toBe(original);
  });
  it("marks only the first note for a separator, including after deletion", () => {
    const source = "First[^a] second[^b].\n\n[^a]: A.\n\n[^b]: B.";
    const editor = document.createElement("div");
    editor.innerHTML = footnoteRenderer.render(source);
    const definitions = editor.querySelectorAll(".wiki-richtext-footnote");
    expect(definitions[0].classList.contains("wiki-richtext-footnote-first")).toBe(true);
    expect(definitions[1].classList.contains("wiki-richtext-footnote-first")).toBe(false);
    definitions[0].remove();
    updateEditableFootnoteNumbers(editor, "Second[^b].\n\n[^b]: B.");
    expect(definitions[1].classList.contains("wiki-richtext-footnote-first")).toBe(true);
  });
  it("keeps a new reference and its definition together as the inserted node is undone", () => {
    const editor = document.createElement("div");
    const marker = document.createElement("span");
    marker.setAttribute(FOOTNOTE_SOURCE_ATTR, encodeURIComponent("[^1]"));
    marker.setAttribute(FOOTNOTE_PENDING_DEFINITION_ATTR, encodeURIComponent("[^1]: A note"));
    marker.textContent = "[^1]";
    const p = document.createElement("p");
    p.append("Text", marker);
    editor.append(p);
    expect(richTextMarkdown(editor, turndown)).toBe("Text[^1]\n\n[^1]: A note");
    const repeated = marker.cloneNode(true) as HTMLElement;
    p.append(repeated);
    expect(richTextMarkdown(editor, turndown)).toBe("Text[^1][^1]\n\n[^1]: A note");
    marker.remove();
    expect(richTextMarkdown(editor, turndown)).toBe("Text[^1]\n\n[^1]: A note");
    repeated.remove();
    expect(richTextMarkdown(editor, turndown)).toBe("Text");
  });
  it("preserves repeated references and multi-paragraph definitions", () => {
    const source = "Text[^a] again[^a].\n\n[^a]: First **note**.\n\n    Second paragraph.\n\nAfter.";
    expect(turndown.turndown(footnoteRenderer.render(source))).toBe(source);
  });
  it("preserves inline and unreferenced notes", () => {
    const source = "Inline^[a note] and unfinished[^missing].\n\n[^unused]: Definition.";
    expect(turndown.turndown(footnoteRenderer.render(source))).toBe(source);
  });
  it("leaves examples in code blocks unchanged", () => {
    const source = "```md\n[^a]: code\n```";
    expect(turndown.turndown(footnoteRenderer.render(source))).toBe(source);
  });
  it("preserves footnotes inside block quotes", () => {
    const source = "> Text[^a].\n>\n> [^a]: Note.";
    expect(turndown.turndown(footnoteRenderer.render(source)).replace(/^> $/gm, ">")).toBe(source);
  });
  it("preserves content with quotes and angle brackets in a footnote", () => {
    const source = 'Text[^a].\n\n[^a]: "quoted" <value> & more.';
    expect(turndown.turndown(footnoteRenderer.render(source))).toBe(source);
  });
  it("renders nested footnote-like text without recursive rendering", () => {
    const source = "Text[^n].\n\n[^n]: " + "[^nested]: ".repeat(300) + "content";
    expect(() => footnoteRenderer.render(source)).not.toThrow();
    expect(turndown.turndown(footnoteRenderer.render(source))).toBe(source);
  });
});

describe("mentions", () => {
  it("writes the identity back, not the display name shown in the editor", () => {
    const html = `<p>Ask ${mentionChip(ADA, "Ada Lovelace")} about it.</p>`;

    // The name is a display convenience; the attribute is the data. Emitting
    // "@Ada Lovelace" would look right and silently destroy the mention.
    expect(turndown.turndown(html)).toBe(`Ask @<${ADA}> about it.`);
  });

  it("keeps several mentions in one paragraph apart", () => {
    const html = `<p>${mentionChip(ADA, "Ada")} and ${mentionChip(GRACE, "Grace")}</p>`;

    expect(turndown.turndown(html)).toBe(`@<${ADA}> and @<${GRACE}>`);
  });

  it("writes an unresolved chip back too, so a failed lookup costs nothing", () => {
    // The name never arrived and the chip still reads "@…", which must not be
    // what lands in the file.
    const html = `<p>${mentionChip(ADA, "…")}</p>`;

    expect(turndown.turndown(html)).toBe(`@<${ADA}>`);
  });

  it("leaves an ordinary span alone", () => {
    expect(turndown.turndown("<p><span>not a mention</span></p>")).toBe("not a mention");
  });

  it("survives a full round trip through the editor's own conversion", () => {
    const source = `Ask @<${ADA}> about it.`;
    // What the editor holds after rendering that source and naming the chip.
    const inEditor = `<p>Ask ${mentionChip(ADA, "Ada Lovelace")} about it.</p>`;

    expect(turndown.turndown(inEditor)).toBe(source);
  });
});

describe("the rules that were already there", () => {
  it("still emits the portable wiki path for an image, not the resolved URL", () => {
    const html =
      '<p><img src="https://dev.azure.com/authed/x.png" data-wiki-src="/.attachments/x.png" alt="A"></p>';

    expect(turndown.turndown(html)).toBe("![A](/.attachments/x.png)");
  });

  it("still preserves an authored image size", () => {
    const html = '<p><img src="/.attachments/x.png" data-wiki-src="/.attachments/x.png" width="500" height="250"></p>';

    expect(turndown.turndown(html)).toBe("![](/.attachments/x.png =500x250)");
  });

  it("still writes a hard line break as two trailing spaces", () => {
    expect(turndown.turndown("<p>one<br>two</p>")).toBe("one  \ntwo");
  });

  it("still round-trips a GFM table rather than flattening it", () => {
    const html = "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>";

    expect(turndown.turndown(html)).toContain("| A | B |");
    expect(turndown.turndown(html)).toContain("| 1 | 2 |");
  });
});

describe("emoji", () => {
  const chip = (shortcode: string, character: string) =>
    `<span ${EMOJI_ATTR}="${shortcode}">${character}</span>`;

  it("writes the shortcode the author typed, not the character", () => {
    // Otherwise editing one paragraph rewrites every emoji on the page.
    const html = `<p>Status ${chip(":green_circle:", "\u{1F7E2}")} good</p>`;

    expect(turndown.turndown(html)).toBe("Status :green_circle: good");
  });

  it("keeps text typed inside the element rather than dropping it", () => {
    // The caret can land inside the span, and the shortcode is then no longer
    // a faithful description of what is there.
    const html = `<p>${chip(":tada:", "\u{1F389}done")}</p>`;

    expect(turndown.turndown(html)).toBe("\u{1F389}done");
  });

  it("leaves a pasted emoji character alone", () => {
    expect(turndown.turndown("<p>\u{1F7E2} ready</p>")).toBe("\u{1F7E2} ready");
  });
});
