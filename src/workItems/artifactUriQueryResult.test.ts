import { describe, expect, it } from "vitest";

import { workItemIdsForArtifactUri } from "./artifactUriQueryResult";

const URI =
  "vstfs:///Wiki/WikiPage/adf21ddb-12ae-4355-924a-8121484e984e%2Ffec63798-8c2b-45b3-921a-2396ea48c13d%2FPowerWiki%20Showcase%2FMermaid%20Gallery";

describe("workItemIdsForArtifactUri", () => {
  it("reads the ids returned for the requested URI", () => {
    const result = { artifactUrisQueryResult: { [URI]: [{ id: 601 }, { id: 42 }] } };

    expect(workItemIdsForArtifactUri(result, URI)).toEqual([601, 42]);
  });

  it("matches the key case-insensitively, as the service does", () => {
    const result = { artifactUrisQueryResult: { [URI.toLowerCase()]: [{ id: 601 }] } };

    expect(workItemIdsForArtifactUri(result, URI)).toEqual([601]);
  });

  it("returns nothing for a URI with no links", () => {
    const result = { artifactUrisQueryResult: { [URI]: [] } };

    expect(workItemIdsForArtifactUri(result, URI)).toEqual([]);
  });

  it("returns nothing when the URI is absent from the response", () => {
    const result = { artifactUrisQueryResult: { "vstfs:///Wiki/WikiPage/other": [{ id: 7 }] } };

    expect(workItemIdsForArtifactUri(result, URI)).toEqual([]);
  });

  it("survives an empty or malformed response", () => {
    expect(workItemIdsForArtifactUri(undefined, URI)).toEqual([]);
    expect(workItemIdsForArtifactUri({}, URI)).toEqual([]);
  });

  it("collapses duplicate references to one row", () => {
    const result = { artifactUrisQueryResult: { [URI]: [{ id: 601 }, { id: 601 }] } };

    expect(workItemIdsForArtifactUri(result, URI)).toEqual([601]);
  });
});
