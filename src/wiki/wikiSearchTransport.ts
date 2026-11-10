import * as SDK from "azure-devops-extension-sdk";

import type { SearchTransport } from "./wikiSearch";

// The network half of wikiSearch. Services needs a token-authenticated POST;
// Server's collection-local endpoint uses the authenticated browser session.
//
// It is separate from wikiSearch so the request building and response mapping
// stay testable without a network or the extension SDK — the sandbox injects an
// in-memory transport for the same reason.
//
// The Services token is required, not belt-and-braces. Like attachment images (see
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

export interface ServerWikiSearchTransportOptions {
  /** Overridden in tests; production uses the page's same-origin fetch. */
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

    return readSearchResponse(response);
  };
}

/**
 * Azure DevOps Server's in-product search uses `Vss-Fetch` plus the existing
 * same-origin session cookie. Mirror that browser contract instead of sending
 * Server requests to the Services search host.
 */
export function createServerWikiSearchTransport({ fetchImpl }: ServerWikiSearchTransportOptions = {}): SearchTransport {
  return async (url, body) => {
    const response = await (fetchImpl ?? fetch)(url, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "Vss-Fetch"
      },
      body: JSON.stringify(body)
    });
    return readSearchResponse(response);
  };
}

async function readSearchResponse(response: Response): Promise<WikiSearchResponseBody> {
  if (!response.ok) {
    const message = await responseMessage(response);
    throw new Error(message ? `Wiki search failed: ${response.status}: ${message}` : `Wiki search failed: ${response.status}`);
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
}

async function responseMessage(response: Response): Promise<string | undefined> {
  const body: unknown = await response.json().catch(() => undefined);
  if (typeof body !== "object" || body === null || typeof (body as { message?: unknown }).message !== "string") {
    return undefined;
  }
  return (body as { message: string }).message;
}

/** The transport PowerWiki uses inside a real Azure DevOps hub. */
export const azureDevOpsWikiSearchTransport = createWikiSearchTransport({
  getAccessToken: () => SDK.getAccessToken()
});

/** The transport PowerWiki uses for Azure DevOps Server's local Search API. */
export const azureDevOpsServerWikiSearchTransport = createServerWikiSearchTransport();
