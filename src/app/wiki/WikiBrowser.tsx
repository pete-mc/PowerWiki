import { useEffect, useMemo, useState } from "react";

import { MarkdownPreview } from "../../rendering/MarkdownPreview";
import { AzureDevOpsWikiRepositoryClient } from "../../wiki/AzureDevOpsWikiRepositoryClient";
import type { WikiPage, WikiPageSummary, WikiSummary } from "../../wiki/WikiPage";
import { buildWikiPageTree } from "../../wiki/WikiPageTree";
import { StatusMessage } from "./StatusMessage";
import { WikiPageTree } from "./WikiPageTree";
import { WikiSelector } from "./WikiSelector";

interface WikiBrowserProps {
  readonly projectName?: string;
}

type LoadState = "failed" | "loading" | "ready";

export function WikiBrowser({ projectName }: WikiBrowserProps) {
  const [activePage, setActivePage] = useState<WikiPage>();
  const [activeWikiId, setActiveWikiId] = useState<string>();
  const [error, setError] = useState<string>();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [pageList, setPageList] = useState<WikiPageSummary[]>([]);
  const [wikis, setWikis] = useState<WikiSummary[]>([]);

  const wikiClient = useMemo(() => {
    return projectName ? new AzureDevOpsWikiRepositoryClient(projectName) : undefined;
  }, [projectName]);
  const pageTree = useMemo(() => buildWikiPageTree(pageList), [pageList]);

  useEffect(() => {
    if (!wikiClient) {
      setLoadState("failed");
      setError("PowerWiki needs an Azure DevOps project context.");
      return;
    }

    let cancelled = false;

    const client = wikiClient;

    async function loadWikis() {
      setLoadState("loading");
      setError(undefined);

      try {
        const availableWikis = await client.getWikis();

        if (cancelled) {
          return;
        }

        setWikis(availableWikis);

        if (availableWikis.length === 0) {
          setLoadState("ready");
          return;
        }

        setActiveWikiId((currentWikiId) => currentWikiId ?? availableWikis[0]?.id);
      } catch (loadError: unknown) {
        if (!cancelled) {
          setLoadState("failed");
          setError(formatError(loadError));
        }
      }
    }

    void loadWikis();

    return () => {
      cancelled = true;
    };
  }, [wikiClient]);

  useEffect(() => {
    if (!wikiClient || !activeWikiId) {
      return;
    }

    let cancelled = false;

    const client = wikiClient;
    const wikiId = activeWikiId;

    async function loadPages() {
      setLoadState("loading");
      setError(undefined);
      setActivePage(undefined);

      try {
        const pages = await client.getPageList(wikiId);
        const firstPagePath = chooseInitialPagePath(pages);
        const firstPage = firstPagePath ? await client.getPage(wikiId, firstPagePath) : undefined;

        if (cancelled) {
          return;
        }

        setPageList(pages);
        setActivePage(firstPage);
        setLoadState("ready");
      } catch (loadError: unknown) {
        if (!cancelled) {
          setLoadState("failed");
          setError(formatError(loadError));
        }
      }
    }

    void loadPages();

    return () => {
      cancelled = true;
    };
  }, [activeWikiId, wikiClient]);

  async function handlePageSelected(path: string) {
    if (!wikiClient || !activeWikiId) {
      return;
    }

    setLoadState("loading");
    setError(undefined);

    try {
      setActivePage(await wikiClient.getPage(activeWikiId, path));
      setLoadState("ready");
    } catch (loadError: unknown) {
      setLoadState("failed");
      setError(formatError(loadError));
    }
  }

  if (loadState === "failed") {
    return (
      <StatusMessage
        message={error ?? "PowerWiki could not load wiki content."}
        title="Unable to load wiki"
      />
    );
  }

  return (
    <section className="powerwiki-layout">
      <aside className="powerwiki-nav" aria-label="Wiki pages">
        <WikiSelector
          activeWikiId={activeWikiId}
          disabled={loadState === "loading"}
          onWikiSelected={setActiveWikiId}
          wikis={wikis}
        />
        <WikiPageTree
          activePath={activePage?.path}
          nodes={pageTree}
          onPageSelected={handlePageSelected}
        />
      </aside>

      <article className="powerwiki-content">
        {activePage ? (
          <MarkdownPreview markdown={activePage.content} />
        ) : (
          <StatusMessage
            message={loadState === "loading" ? "Loading wiki content." : "Select a page to view it."}
            title={loadState === "loading" ? "Loading" : "No page selected"}
          />
        )}
      </article>
    </section>
  );
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "An unknown error occurred while loading wiki content.";
}

function chooseInitialPagePath(pages: readonly WikiPageSummary[]): string | undefined {
  return (
    pages.find((page) => page.path === "/")?.path ??
    [...pages].sort((left, right) =>
      left.path.localeCompare(right.path, undefined, { sensitivity: "base" })
    )[0]?.path
  );
}
