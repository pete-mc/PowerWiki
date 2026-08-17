import * as SDK from "azure-devops-extension-sdk";

import type { SearchTransport } from "./wikiSearch";

// The network half of wikiSearch: a token-authenticated POST to the Azure DevOps
// Search service.
//
// It is separate from wikiSearch so the request building and response mapping
// stay testable without a network or the extension SDK — the sandbox injects an
// in-memory transport for the same reason.
//
// The token is required, not belt-and-braces. Like attachment images (see
// attachmentImage.ts) this is a cross-origin request out of the extension
// iframe, so it carries no Azure DevOps cookies; without a bearer token the
// service treats the caller as anonymous. `SDK.getAccessToken()` issues a token
// for the extension's own scopes, and `vso.wiki` covers search.

/** The transport's own response type, which wikiSearch keeps to itself. */
type WikiSearchResponseBody = Awaited<ReturnType<SearchTransport>>;

export interface WikiSearchTransportOptions {
  readonly getAccessToken: () => Promise<string>;
  /** Overridden in tests; production uses the page's fetch. */
  readonly fetchImpl?: typeof fetch;
}

export function createWikiSearchTransport({
  getAccessToken,
  fetchImpl
}: WikiSearchTransportOptions): SearchTransport {
  return async (url, body) => {
    const token = await getAccessToken();
    const response = await (fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Wiki search failed: ${response.status}`);
    }

    // A successful status is not enough to conclude this is a search result:
    // Azure DevOps answers an unauthenticated caller with a sign-in page and a
    // 2xx status (203 in practice) rather than a 401, so the body is HTML. Say
    // so plainly instead of letting a JSON parse error reach the user.
    const payload: unknown = await response.json().catch(() => undefined);
    if (typeof payload !== "object" || payload === null) {
      throw new Error("The search service did not return a result. Check that you are signed in to Azure DevOps.");
    }

    return payload as WikiSearchResponseBody;
  };
}

/** The transport PowerWiki uses inside a real Azure DevOps hub. */
export const azureDevOpsWikiSearchTransport = createWikiSearchTransport({
  getAccessToken: () => SDK.getAccessToken()
});
