// Entry point for the Power Wiki tab on the work item form.
//
// The same App and the same WikiBrowser as the hub — only the host differs, and
// only in what it declares it can do. On this surface the rail lists the work
// item's linked wiki pages instead of the whole page tree, and the wiki picker,
// full-text search, and VS Code hand-off are off because they belong to the
// full hub rather than to a tab inside one work item.
//
// This is a `work-item-form-page` contribution, which gets the whole form area,
// so the page renders and edits at full size rather than in the cramped strip a
// form group or control would have.

import { createRoot } from "react-dom/client";

import { App } from "../app/App";
import { ErrorBoundary } from "../app/ErrorBoundary";
import { createAzureDevOpsWikiHost } from "../host/azureDevOpsWikiHost";

import "../app/styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("PowerWiki root element was not found.");
}

const root = createRoot(rootElement);

const renderApp = (props: Parameters<typeof App>[0]) =>
  root.render(
    <ErrorBoundary label="PowerWiki">
      <App {...props} />
    </ErrorBoundary>
  );

renderApp({ status: "loading" });

createAzureDevOpsWikiHost("workItem")
  .then((host) => {
    renderApp({ host, status: "ready" });
  })
  .catch((error: unknown) => {
    renderApp({ error, status: "failed" });
  });
