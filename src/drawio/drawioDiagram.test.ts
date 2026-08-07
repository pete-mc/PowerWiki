import { describe, expect, it } from "vitest";

import {
  countDiagramReferences,
  dataUrlToBase64,
  diagramMarkdown,
  diagramTitle,
  isDrawioPath,
  newDiagramName,
  nextDiagramName,
  slugOf,
  slugify,
} from "./drawioDiagram";

describe("isDrawioPath", () => {
  it("matches stored diagrams and ignores other images", () => {
    expect(isDrawioPath("/.attachments/architecture-lk9f2abc1234.drawio.png")).toBe(true);
    expect(isDrawioPath("/.attachments/PHOTO.DRAWIO.PNG")).toBe(true);
    expect(isDrawioPath("/.attachments/screenshot.png")).toBe(false);
    expect(isDrawioPath("/.attachments/diagram.drawio.svg")).toBe(false);
  });
});

describe("slugify", () => {
  it("keeps a readable, filesystem-safe stem", () => {
    expect(slugify("System Architecture")).toBe("System-Architecture");
    expect(slugify("  spaces  ")).toBe("spaces");
    expect(slugify("a/b\\c:d")).toBe("a-b-c-d");
  });

  it("falls back for titles with nothing usable left", () => {
    expect(slugify("///")).toBe("diagram");
    expect(slugify("")).toBe("diagram");
  });
});

describe("slugOf", () => {
  it("strips a revision suffix so the stable name survives edits", () => {
    expect(slugOf("/.attachments/architecture-lk9f2abc1234.drawio.png")).toBe("architecture");
    expect(slugOf("/.attachments/My-Big-Flow-abcdefgh1234.drawio.png")).toBe("My-Big-Flow");
  });

  it("keeps the whole base name when there is no revision suffix", () => {
    // e.g. a .drawio.png produced by another tool and uploaded by hand.
    expect(slugOf("/.attachments/handmade.drawio.png")).toBe("handmade");
    expect(slugOf("/.attachments/too-short-abc.drawio.png")).toBe("too-short-abc");
  });
});

describe("newDiagramName / nextDiagramName", () => {
  it("produces a stable slug with a fresh revision each time", () => {
    const first = newDiagramName("System Architecture");
    expect(first).toMatch(/^System-Architecture-[a-z0-9]{12}\.drawio\.png$/);

    const second = nextDiagramName(`/.attachments/${first}`);
    expect(second).toMatch(/^System-Architecture-[a-z0-9]{12}\.drawio\.png$/);
    expect(second).not.toBe(first);
    // The slug is what makes a diagram recognisable across revisions.
    expect(slugOf(second)).toBe(slugOf(first));
  });

  it("round-trips repeatedly without accumulating suffixes", () => {
    let path = `/.attachments/${newDiagramName("Flow")}`;
    for (let i = 0; i < 5; i += 1) {
      path = `/.attachments/${nextDiagramName(path)}`;
    }
    expect(slugOf(path)).toBe("Flow");
    expect(path).toMatch(/^\/\.attachments\/Flow-[a-z0-9]{12}\.drawio\.png$/);
  });
});

describe("diagramTitle / diagramMarkdown", () => {
  it("builds readable alt text and an image reference", () => {
    const path = "/.attachments/System-Architecture-lk9f2abc1234.drawio.png";
    expect(diagramTitle(path)).toBe("System Architecture");
    expect(diagramMarkdown(path)).toBe(`![System Architecture](${path})`);
    expect(diagramMarkdown(path, "Custom")).toBe(`![Custom](${path})`);
  });

  it("escapes brackets in the label and spaces in the path", () => {
    expect(diagramMarkdown("/.attachments/a b.drawio.png", "A [thing]")).toBe(
      "![A thing](/.attachments/a%20b.drawio.png)"
    );
  });
});

describe("countDiagramReferences", () => {
  const path = "/.attachments/architecture-lk9f2abc1234.drawio.png";

  it("counts raw and percent-encoded references", () => {
    const markdown = [
      `![One](${path})`,
      `![Two](${encodeURI(path)})`,
      "![Other](/.attachments/unrelated.png)",
    ].join("\n\n");
    expect(countDiagramReferences(markdown, path)).toBe(2);
  });

  it("does not match a different diagram with a shared prefix", () => {
    const other = "/.attachments/architecture-lk9f2abc1234.drawio.png.bak";
    expect(countDiagramReferences(`![x](${other})`, path)).toBe(0);
  });

  it("returns zero for a page with no references", () => {
    expect(countDiagramReferences("# Title\n\nSome text.", path)).toBe(0);
  });
});

describe("dataUrlToBase64", () => {
  it("strips the data URL prefix", () => {
    expect(dataUrlToBase64("data:image/png;base64,AAAB")).toBe("AAAB");
  });

  it("passes through bare base64", () => {
    expect(dataUrlToBase64("AAAB")).toBe("AAAB");
  });
});
