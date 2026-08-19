import { Document, Packer, Paragraph, TextRun } from "docx";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { exportPagesToWord } from "./exportWord";
import { readWordTemplate, TEMPLATE_PLACEHOLDER_TOKEN, WordTemplateError } from "./wordTemplate";
import type { PageRenderOptions } from "./renderPageHtml";

const RENDER_OPTIONS = { themeMode: "light" } as PageRenderOptions;

/** Builds a .docx to stand in for a customer's template. */
async function templateDocx(children: Paragraph[]): Promise<ArrayBuffer> {
  const document = new Document({
    styles: {
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Georgia", color: "AA0000" },
        },
      ],
    },
    sections: [{ children }],
  });
  // Copy into a fresh, exactly-sized ArrayBuffer: Packer hands back a view that
  // may sit inside a larger pooled buffer, which JSZip cannot read.
  return new Uint8Array(await Packer.toBuffer(document)).buffer as ArrayBuffer;
}

async function documentXmlOf(data: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  return (await zip.file("word/document.xml")?.async("string")) ?? "";
}

/** Runs an export and returns the bytes handed to `save`. */
async function exportWith(markdown: string, template?: Awaited<ReturnType<typeof readWordTemplate>>) {
  let saved: Blob | undefined;
  await exportPagesToWord(
    [{ title: "Page", path: "/Page", content: markdown }],
    RENDER_OPTIONS,
    async () => null,
    "Page.docx",
    async (_name, blob) => {
      saved = blob;
    },
    template
  );
  if (!saved) {
    throw new Error("export did not save anything");
  }
  return saved.arrayBuffer();
}

describe("readWordTemplate", () => {
  it("finds the content placeholder", async () => {
    const data = await templateDocx([new Paragraph({ text: TEMPLATE_PLACEHOLDER_TOKEN })]);

    const template = await readWordTemplate(data);

    expect(template.hasPlaceholder).toBe(true);
  });

  // Word splits a typed token across runs whenever formatting or a spell-check
  // boundary falls inside it. Matching the raw XML would miss those templates.
  it("finds the placeholder even when Word split it across runs", async () => {
    const data = await templateDocx([
      new Paragraph({ children: [new TextRun("{{PowerWiki"), new TextRun("Content}}")] }),
    ]);

    const template = await readWordTemplate(data);

    expect(template.hasPlaceholder).toBe(true);
  });

  it("reports no placeholder but still carries the styles", async () => {
    const data = await templateDocx([new Paragraph({ text: "Cover page only" })]);

    const template = await readWordTemplate(data);

    expect(template.hasPlaceholder).toBe(false);
    expect(template.stylesXml).toContain("Georgia");
  });

  it("rejects a file that is not a Word document", async () => {
    const notADocx = new TextEncoder().encode("this is a text file").buffer as ArrayBuffer;

    await expect(readWordTemplate(notADocx)).rejects.toBeInstanceOf(WordTemplateError);
  });

  it("rejects a zip that is not a Word document", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "not word");
    const data = (await zip.generateAsync({ type: "arraybuffer" })) as ArrayBuffer;

    await expect(readWordTemplate(data)).rejects.toBeInstanceOf(WordTemplateError);
  });
});

describe("exportPagesToWord with a template", () => {
  it("keeps the template's own content around the exported pages", async () => {
    const data = await templateDocx([
      new Paragraph({ text: "ACME CONFIDENTIAL" }),
      new Paragraph({ text: TEMPLATE_PLACEHOLDER_TOKEN }),
    ]);
    const template = await readWordTemplate(data);

    const xml = await documentXmlOf(await exportWith("Exported body text", template));

    expect(xml).toContain("ACME CONFIDENTIAL");
    expect(xml).toContain("Exported body text");
    // The marker itself must not survive into the delivered document.
    expect(xml).not.toContain(TEMPLATE_PLACEHOLDER_TOKEN);
  });

  // patchDocument does not fail on a template with no placeholder — it returns
  // the template with the content dropped. Falling back to the template's
  // styles is what stops that from silently losing the entire export.
  it("falls back to styles when the template has no placeholder", async () => {
    const data = await templateDocx([new Paragraph({ text: "Cover page only" })]);
    const template = await readWordTemplate(data);

    const exported = await exportWith("Exported body text", template);
    const xml = await documentXmlOf(exported);
    const zip = await JSZip.loadAsync(exported);
    const styles = await zip.file("word/styles.xml")?.async("string");

    expect(xml).toContain("Exported body text");
    expect(styles).toContain("Georgia");
  });

  it("still exports with PowerWiki's own styling when no template is given", async () => {
    const exported = await exportWith("Exported body text");
    const zip = await JSZip.loadAsync(exported);
    const styles = await zip.file("word/styles.xml")?.async("string");

    expect(await documentXmlOf(exported)).toContain("Exported body text");
    expect(styles).toContain("Calibri");
  });
});
