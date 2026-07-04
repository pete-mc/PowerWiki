import { Document, Packer } from "docx";
import { describe, expect, it } from "vitest";

import { markdownToDocxBlocks } from "./markdownToDocx";

const MARKDOWN = [
  "# Title",
  "",
  "Hello **world** with _emphasis_ and `code` and a [link](https://example.com).",
  "",
  "## Section",
  "",
  "- one",
  "- two",
  "  - nested",
  "",
  "> a quote",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  "| A | B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "![missing](/.attachments/none.png)",
].join("\n");

describe("markdownToDocxBlocks", () => {
  it("packs Markdown into a valid .docx (zip) document", async () => {
    const blocks = await markdownToDocxBlocks(MARKDOWN, { loadImage: async () => null });
    expect(blocks.length).toBeGreaterThan(0);

    const doc = new Document({ sections: [{ children: blocks }] });
    const buffer = await Packer.toBuffer(doc);
    // .docx is a zip — the first two bytes are the "PK" local-file signature.
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it("skips images it can't load without throwing", async () => {
    const blocks = await markdownToDocxBlocks("![x](/.attachments/x.png)", { loadImage: async () => null });
    expect(blocks.length).toBe(1);
  });
});
