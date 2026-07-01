import { createRoot } from "react-dom/client";

import { App } from "../app/App";
import { initializeAzureDevOpsHost } from "./azureDevOpsHost";

import "../app/styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("PowerWiki root element was not found.");
}

const root = createRoot(rootElement);

root.render(<App status="loading" />);

initializeAzureDevOpsHost()
  .then((hostContext) => {
    root.render(<App hostContext={hostContext} status="ready" />);
  })
  .catch((error: unknown) => {
    root.render(<App error={error} status="failed" />);
  });
