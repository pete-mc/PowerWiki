import { describe, expect, it } from "vitest";

import {
  alreadyLinked,
  buildWikiArtifactUrl,
  linkedWikiPagesFrom,
  parseWikiArtifactUrl,
  wikiPageRelation,
  wikiPageRelationsFor,
} from "./workItemWikiLinks";

const PROJECT = "adf21ddb-12ae-4355-924a-8121484e984e";
const WIKI = "fec63798-8c2b-45b3-921a-2396ea48c13d";

// Captured from a real link created through the Azure DevOps API, so the shape
// here is the product's rather than an assumption about it.
const REAL_URL =
  "vstfs:///Wiki/WikiPage/adf21ddb-12ae-4355-924a-8121484e984e%2Ffec63798-8c2b-45b3-921a-2396ea48c13d%2FPowerWiki%20Showcase%2FMermaid%20Gallery";

function relation(url: string, name = "Wiki Page", comment?: string) {
  return { rel: "ArtifactLink", url, attributes: { name, ...(comment ? { comment } : {}) } };
}

describe("wiki artifact URLs", () => {
  it("builds the URL Azure DevOps stores", () => {
    expect(buildWikiArtifactUrl({ projectId: PROJECT, wikiId: WIKI, path: "/PowerWiki Showcase/Mermaid Gallery" })).toBe(
      REAL_URL
    );
  });

  it("round-trips a nested page path", () => {
    const page = { projectId: PROJECT, wikiId: WIKI, path: "/A/B/C page" };

    expect(parseWikiArtifactUrl(buildWikiArtifactUrl(page))).toEqual(page);
  });

  it("parses a URL captured from Azure DevOps", () => {
    expect(parseWikiArtifactUrl(REAL_URL)).toEqual({
      projectId: PROJECT,
      wikiId: WIKI,
      path: "/PowerWiki Showcase/Mermaid Gallery",
    });
  });

  // The separators between the ids and inside the page path are both %2F, so
  // splitting the raw value on "/" works until a page is nested.
  it("keeps the whole nested path rather than stopping at the first slash", () => {
    const parsed = parseWikiArtifactUrl(REAL_URL);

    expect(parsed?.path).toBe("/PowerWiki Showcase/Mermaid Gallery");
  });

  it("ignores links that are not wiki pages", () => {
    expect(parseWikiArtifactUrl("vstfs:///Git/PullRequestId/1%2F2%2F3")).toBeUndefined();
  });

  it("ignores a malformed wiki URL", () => {
    expect(parseWikiArtifactUrl("vstfs:///Wiki/WikiPage/onlyoneid")).toBeUndefined();
  });
});

describe("linkedWikiPagesFrom", () => {
  it("selects only wiki page links", () => {
    const pages = linkedWikiPagesFrom([
      relation(REAL_URL),
      // Same rel, different artifact — must not be mistaken for a wiki page.
      { rel: "ArtifactLink", url: "vstfs:///Build/Build/42", attributes: { name: "Build" } },
      { rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://example/1" },
    ]);

    expect(pages).toHaveLength(1);
    expect(pages[0].path).toBe("/PowerWiki Showcase/Mermaid Gallery");
  });

  it("carries the link comment through", () => {
    const pages = linkedWikiPagesFrom([relation(REAL_URL, "Wiki Page", "Architecture diagrams")]);

    expect(pages[0].comment).toBe("Architecture diagrams");
  });

  it("treats an empty comment as absent", () => {
    const pages = linkedWikiPagesFrom([relation(REAL_URL, "Wiki Page", "")]);

    expect(pages[0].comment).toBeUndefined();
  });

  it("skips a wiki link whose URL cannot be parsed", () => {
    expect(linkedWikiPagesFrom([relation("vstfs:///Wiki/WikiPage/broken")])).toEqual([]);
  });
});

describe("wikiPageRelation", () => {
  it("produces a relation Azure DevOps recognises as a wiki page", () => {
    const built = wikiPageRelation({ projectId: PROJECT, wikiId: WIKI, path: "/Home" }, "Notes");

    expect(built.rel).toBe("ArtifactLink");
    expect(built.attributes.name).toBe("Wiki Page");
    expect(built.attributes.comment).toBe("Notes");
    expect(parseWikiArtifactUrl(built.url)?.path).toBe("/Home");
  });

  it("omits the comment when there is none", () => {
    expect(wikiPageRelation({ projectId: PROJECT, wikiId: WIKI, path: "/Home" }).attributes.comment).toBeUndefined();
  });
});

describe("alreadyLinked", () => {
  it("spots a page that is already linked", () => {
    expect(alreadyLinked([relation(REAL_URL)], "/PowerWiki Showcase/Mermaid Gallery")).toBe(true);
  });

  it("does not confuse a different page", () => {
    expect(alreadyLinked([relation(REAL_URL)], "/Home")).toBe(false);
  });
});

describe("wikiPageRelationsFor", () => {
  it("returns the relation object it was given, not a rebuilt one", () => {
    // Identity is the point: `removeWorkItemRelations` is handed relations back,
    // and one reconstructed from the path would be missing whatever the form
    // service attached to the real one.
    const real = relation(REAL_URL);
    const found = wikiPageRelationsFor([real], "/PowerWiki Showcase/Mermaid Gallery");

    expect(found).toHaveLength(1);
    expect(found[0]).toBe(real);
  });

  it("matches a path written without its leading slash", () => {
    expect(wikiPageRelationsFor([relation(REAL_URL)], "PowerWiki Showcase/Mermaid Gallery")).toHaveLength(1);
  });

  it("returns every relation linking the same page, so unlinking clears it", () => {
    const first = relation(REAL_URL);
    const second = relation(REAL_URL, "Wiki Page", "added twice");

    expect(wikiPageRelationsFor([first, second], "/PowerWiki Showcase/Mermaid Gallery")).toEqual([first, second]);
  });

  it("leaves other pages, other artifact links and other rels alone", () => {
    const other = relation(buildWikiArtifactUrl({ projectId: PROJECT, wikiId: WIKI, path: "/Home" }));
    const commit = relation("vstfs:///Git/Commit/abc", "Fixed in Commit");
    const child = { rel: "System.LinkTypes.Hierarchy-Forward", url: "https://example/1" };

    expect(wikiPageRelationsFor([other, commit, child], "/PowerWiki Showcase/Mermaid Gallery")).toEqual([]);
  });

  it("finds nothing when the page is not linked", () => {
    expect(wikiPageRelationsFor([relation(REAL_URL)], "/Home")).toEqual([]);
  });
});
