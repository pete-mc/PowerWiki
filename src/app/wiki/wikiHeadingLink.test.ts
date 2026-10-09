import { describe, expect, it } from "vitest";

import { buildHubPageUrl, HUB_ROUTE_PARAM, splitHashAnchor, withHashAnchor } from "./wikiHeadingLink";

const context = {
  organizationName: "dataversepowertools",
  projectName: "dataversepowertools",
  organizationIsHosted: true,
  contributionId: "dataversepowertools.powerwiki.wiki",
};

describe("splitHashAnchor", () => {
  it("returns the page hash unchanged when there is no anchor", () => {
    expect(splitHashAnchor("/PowerWiki Showcase/Mermaid Gallery")).toEqual({
      pageHash: "/PowerWiki Showcase/Mermaid Gallery",
    });
  });

  it("splits off and decodes the anchor slug", () => {
    expect(splitHashAnchor("#/Home&anchor=sequence-diagram")).toEqual({
      pageHash: "/Home",
      anchor: "sequence-diagram",
    });
    expect(splitHashAnchor("/Page&anchor=a%20b").anchor).toBe("a b");
  });
});

describe("withHashAnchor", () => {
  it("appends an anchor", () => {
    expect(withHashAnchor("/Home", "intro")).toBe("/Home&anchor=intro");
  });

  it("replaces an existing anchor rather than stacking them", () => {
    expect(withHashAnchor("/Home&anchor=old", "new")).toBe("/Home&anchor=new");
  });
});

describe("buildHubPageUrl", () => {
  it("builds an absolute Azure DevOps hub url with an anchor", () => {
    expect(buildHubPageUrl(context, "/PowerWiki Showcase/Mermaid Gallery", "sequence-diagram")).toBe(
      "https://dev.azure.com/dataversepowertools/dataversepowertools/_apps/hub/" +
        "dataversepowertools.powerwiki.wiki?route=/PowerWiki%20Showcase/Mermaid%20Gallery%26anchor%3Dsequence-diagram" +
        "#/PowerWiki Showcase/Mermaid Gallery&anchor=sequence-diagram"
    );
  });

  // The hash does not survive Azure DevOps sign-in; the query does. A link
  // opened in a browser with no session must still find its page.
  it("carries the route in the query, where it survives sign-in, decoding back to the hash", () => {
    const pageHash = "/wikis/Team%20Wiki/List-%252D-Firewall-rules";
    const url = new URL(buildHubPageUrl(context, pageHash, "a & b") ?? "");

    expect(url.searchParams.get(HUB_ROUTE_PARAM)).toBe(url.hash.slice(1));
    expect(url.searchParams.get(HUB_ROUTE_PARAM)).toBe(withHashAnchor(pageHash, "a & b"));
  });

  it("adds a leading slash to the page hash when missing", () => {
    expect(buildHubPageUrl(context, "Home")).toBe(
      "https://dev.azure.com/dataversepowertools/dataversepowertools/_apps/hub/" +
        "dataversepowertools.powerwiki.wiki?route=/Home#/Home"
    );
  });

  it("returns undefined for on-prem or incomplete context", () => {
    expect(buildHubPageUrl({ ...context, organizationIsHosted: false }, "/Home", "x")).toBeUndefined();
    expect(buildHubPageUrl({ ...context, contributionId: undefined }, "/Home", "x")).toBeUndefined();
    expect(buildHubPageUrl({ ...context, projectName: undefined }, "/Home", "x")).toBeUndefined();
  });
});
