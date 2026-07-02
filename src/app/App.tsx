import { useCallback, useEffect, useMemo, useState } from "react";

import type { AzureDevOpsHostContext } from "../extension/azureDevOpsHost";
import { WikiBrowser } from "./wiki/WikiBrowser";
import packageMetadata from "../../package.json";

interface AppProps {
  readonly error?: unknown;
  readonly hostContext?: AzureDevOpsHostContext;
  readonly status: "failed" | "loading" | "ready";
}

export function App({ error, hostContext, status }: AppProps) {
  const [pageTitle, setPageTitle] = useState<string>();
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
  const headerTitle = useMemo(() => {
    if (status === "loading") {
      return "Loading PowerWiki";
    }

    if (status === "failed") {
      return "Unable to load PowerWiki";
    }

    return pageTitle ?? "PowerWiki";
  }, [pageTitle, status]);
  const handlePageTitleChange = useCallback((title: string | undefined) => {
    setPageTitle(title);
  }, []);

  useEffect(() => {
    if (status !== "ready") {
      setPageTitle(undefined);
    }
  }, [status]);

  return (
    <main className="powerwiki-shell">
      <header className="powerwiki-header">
        <div className="powerwiki-header-title">
          <h1>{headerTitle}</h1>
          <p>{statusText}</p>
        </div>
        <div className="powerwiki-brand" aria-label={`PowerWiki version ${packageMetadata.version}`}>
          <img alt="" src="../media/logo_new.png" />
          <div>
            <strong>PowerWiki</strong>
            <span>Version {packageMetadata.version}</span>
          </div>
        </div>
      </header>

      {status === "failed" ? (
        <section className="powerwiki-panel" role="alert">
          <h2>Unable to load PowerWiki</h2>
          <p>{formatError(error)}</p>
        </section>
      ) : (
        <WikiBrowser
          onPageTitleChange={handlePageTitleChange}
          projectName={hostContext?.projectName}
        />
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
