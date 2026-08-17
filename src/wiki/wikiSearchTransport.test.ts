import { describe, expect, it } from "vitest";

import { createWikiSearchTransport } from "./wikiSearchTransport";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("createWikiSearchTransport", () => {
  it("posts the query as JSON with the extension's access token", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const transport = createWikiSearchTransport({
      getAccessToken: async () => "token-123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse({ count: 0, infoCode: 0, results: [] });
      }
    });

    const body = await transport("https://almsearch.dev.azure.com/org/project/_apis/search/wikisearchresults", {
      searchText: "mermaid",
      $skip: 0,
      $top: 50
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer token-123",
      "Content-Type": "application/json"
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ searchText: "mermaid", $skip: 0, $top: 50 });
    expect(body).toEqual({ count: 0, infoCode: 0, results: [] });
  });

  it("reports the status when the service rejects the request", async () => {
    const transport = createWikiSearchTransport({
      getAccessToken: async () => "token",
      fetchImpl: async () => new Response("nope", { status: 403 })
    });

    await expect(transport("https://example.invalid", {})).rejects.toThrow("Wiki search failed: 403");
  });

  // A signed-out Azure DevOps request is answered with a sign-in page and a 2xx
  // status, so "the status was fine" tells us nothing about the body.
  it("treats a successful response that is not JSON as a sign-in problem", async () => {
    const transport = createWikiSearchTransport({
      getAccessToken: async () => "token",
      fetchImpl: async () =>
        new Response("<html>Sign in</html>", { status: 203, headers: { "Content-Type": "text/html" } })
    });

    await expect(transport("https://example.invalid", {})).rejects.toThrow(/signed in/);
  });
});
