// What the rich text editor writes back to the wiki file.
//
// A save from WYSIWYG mode replaces the page with whatever Turndown makes of the
// editor's DOM, so a missing rule is not a rendering glitch — it is the stored
// Markdown losing something the author never touched.

import { describe, expect, it } from "vitest";

import { MENTION_ATTR } from "../../rendering/adoMentionsPlugin";
import { EMOJI_ATTR } from "../../rendering/emojiPlugin";
import { createRichTextTurndown } from "./richTextTurndown";

const ADA = "a502d9c7-0cbd-45de-9b3f-1c2d3e4f5a6b";
const GRACE = "b613e0d8-1dce-46ef-ac40-2d3e4f5a6b7c";

const turndown = createRichTextTurndown();
const mentionChip = (id: string, name: string) =>
  `<span class="powerwiki-mention" ${MENTION_ATTR}="${id}">@${name}</span>`;

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
