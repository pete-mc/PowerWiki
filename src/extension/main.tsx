import { createRoot } from "react-dom/client";

import { App } from "../app/App";
import { ErrorBoundary } from "../app/ErrorBoundary";
import { initializeAzureDevOpsHost } from "./azureDevOpsHost";

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

initializeAzureDevOpsHost()
  .then((hostContext) => {
    renderApp({ hostContext, status: "ready" });
  })
  .catch((error: unknown) => {
    renderApp({ error, status: "failed" });
  });
