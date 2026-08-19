import { createRoot } from "react-dom/client";

import { App } from "../app/App";
import { ErrorBoundary } from "../app/ErrorBoundary";
import { FakeWikiRepositoryClient } from "./FakeWikiRepositoryClient";
import { SandboxWikiHost } from "./sandboxWikiHost";
import { createFakeWikiSearchTransport } from "./fakeWikiSearch";
import { SANDBOX_PAGES } from "./fixtures";

import "../app/styles.css";

/**
 * Local sandbox entry point.
 *
 * The production entry (`src/extension/main.tsx`) calls
 * `initializeAzureDevOpsHost()`, which requires the Azure DevOps extension SDK
 * to be running inside a real hub iframe. This entry skips the SDK entirely and
 * supplies a static host context plus an in-memory wiki client, so the UI runs as
 * an ordinary page at `http://localhost:3000/sandbox.html`.
 *
 * Why this exists: until now the only way to exercise PowerWiki was to publish to
 * the Marketplace, which auto-updates every installed organization. Most of this
 * codebase — rendering, the editors, the page tree, export — needs none of that.
 *
 * This bundle is only built in development mode (see `webpack.config.js`), so it
 * never ships inside the packaged extension.
 */
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("PowerWiki sandbox root element was not found.");
}

const parameters = new URLSearchParams(window.location.search);

// Latency is deliberate, not incidental: with instant responses the loading and
// empty states never render, and those are exactly the states that regress.
const latencyMs = Number(parameters.get("latency") ?? 120);

const wikiClient = new FakeWikiRepositoryClient(SANDBOX_PAGES, {
  latencyMs: Number.isFinite(latencyMs) ? latencyMs : 120
});

// Search would otherwise be the one feature the sandbox could not show at all,
// because it is the only part of the UI that talks to a host other than the wiki
// API. `?searchInfoCode=2` makes the fake answer the way an organization whose
// index is still building does — zero results, HTTP 200 — which is the state
// worth being able to look at and impossible to reproduce on demand for real.
const searchInfoCode = Number(parameters.get("searchInfoCode") ?? 0);
const searchTransport = createFakeWikiSearchTransport(SANDBOX_PAGES, {
  infoCode: Number.isFinite(searchInfoCode) ? searchInfoCode : 0,
  latencyMs: Number.isFinite(latencyMs) ? latencyMs : 120
});

// Mirrors what SDK.getWebContext()/getUser() would return in a real hub. The
// contribution id keeps shareable heading links working.
const hostContext = {
  contributionId: "dataversepowertools.powerwiki-sandbox.wiki",
  organizationIsHosted: true,
  organizationName: "sandbox",
  projectId: "00000000-0000-0000-0000-000000000000",
  projectName: "Sandbox",
  userDisplayName: "Sandbox User",
  userId: "11111111-1111-1111-1111-111111111111"
};

createRoot(rootElement).render(
  <ErrorBoundary label="PowerWiki sandbox">
    <App host={new SandboxWikiHost(hostContext, wikiClient, searchTransport)} status="ready" />
  </ErrorBoundary>
);
