import { useMemo } from "react";

import type { AzureDevOpsHostContext } from "../extension/azureDevOpsHost";
import { WikiBrowser } from "./wiki/WikiBrowser";

interface AppProps {
  readonly error?: unknown;
  readonly hostContext?: AzureDevOpsHostContext;
  readonly status: "failed" | "loading" | "ready";
}

export function App({ error, hostContext, status }: AppProps) {
  const statusText = useMemo(() => {
    if (status === "loading") {
      return "Connecting to Azure DevOps";
    }

    if (status === "failed") {
      return "Azure DevOps host initialization failed";
    }

    return hostContext?.projectName
      ? `Project: ${hostContext.projectName}`
      : "Project context unavailable";
  }, [hostContext?.projectName, status]);

  return (
    <main className="powerwiki-shell">
      <header className="powerwiki-header">
        <div>
          <h1>PowerWiki</h1>
          <p>{statusText}</p>
        </div>
      </header>

      {status === "failed" ? (
        <section className="powerwiki-panel" role="alert">
          <h2>Unable to load PowerWiki</h2>
          <p>{formatError(error)}</p>
        </section>
      ) : (
        <WikiBrowser projectName={hostContext?.projectName} />
      )}
    </main>
  );
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "An unknown error occurred while initializing the extension host.";
}
