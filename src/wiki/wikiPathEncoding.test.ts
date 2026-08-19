import { describe, expect, it } from "vitest";

import {
  fileSegmentToPageSegment,
  pagePathToRelativePath,
  pageSegmentToFileSegment,
  parentPagePath,
  relativePathToPagePath
} from "./wikiPathEncoding";

describe("wiki path encoding", () => {
  it("stores spaces as hyphens", () => {
    expect(pageSegmentToFileSegment("Getting Started")).toBe("Getting-Started");
    expect(fileSegmentToPageSegment("Getting-Started")).toBe("Getting Started");
  });

  // The pair that makes the encoding necessary at all: without %2D these two
  // page names would share one file.
  it("keeps a literal hyphen distinct from a space", () => {
    expect(pageSegmentToFileSegment("Well-known")).toBe("Well%2Dknown");
    expect(pageSegmentToFileSegment("Well known")).toBe("Well-known");
    expect(fileSegmentToPageSegment("Well%2Dknown")).toBe("Well-known");
    expect(fileSegmentToPageSegment("Well-known")).toBe("Well known");
  });

  it("encodes characters that cannot appear in a file name", () => {
    expect(pageSegmentToFileSegment('A: "B" <C>')).toBe("A%3A-%22B%22-%3CC%3E");
    expect(fileSegmentToPageSegment("A%3A-%22B%22-%3CC%3E")).toBe('A: "B" <C>');
  });

  // Decoding %2D before hyphens is what makes this work; the other order would
  // turn the escaped hyphen into a space.
  it("round-trips a title mixing spaces and hyphens", () => {
    const title = "Set-up the build - step 2";
    expect(fileSegmentToPageSegment(pageSegmentToFileSegment(title))).toBe(title);
  });

  it("leaves an escape it did not produce alone", () => {
    expect(fileSegmentToPageSegment("Literal%41")).toBe("Literal%41");
  });

  it("maps page paths to repository paths and back", () => {
    expect(pagePathToRelativePath("/Getting Started/Set-up")).toBe("Getting-Started/Set%2Dup");
    expect(relativePathToPagePath("Getting-Started/Set%2Dup.md")).toBe("/Getting Started/Set-up");
    expect(relativePathToPagePath("Home.md")).toBe("/Home");
    expect(relativePathToPagePath("")).toBe("/");
  });

  it("finds a page's parent", () => {
    expect(parentPagePath("/A/B/C")).toBe("/A/B");
    expect(parentPagePath("/A")).toBe("/");
    expect(parentPagePath("/")).toBe("/");
  });
});
