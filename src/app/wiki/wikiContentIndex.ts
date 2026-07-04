// Loads every page's Markdown for features that need the whole wiki's content:
// client-side search and inbound-link updates after a rename/move. Walks the
// page tree breadth-first, then fetches page bodies with bounded concurrency.

import type { WikiPage, WikiPageSummary } from "../../wiki/WikiPage";

export interface IndexedWikiPage {
  readonly path: string;
  readonly title: string;
  readonly content: string;
}

interface ContentIndexClient {
  getChildPages(wikiId: string, parentPath: string): Promise<WikiPageSummary[]>;
  getPage(wikiId: string, path: string): Promise<WikiPage>;
}

const FETCH_CONCURRENCY = 5;

export async function loadAllWikiPages(
  client: ContentIndexClient,
  wikiId: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<IndexedWikiPage[]> {
  // 1. Discover every page path.
  const paths: string[] = [];
  const queue: string[] = ["/"];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    const children = await client.getChildPages(wikiId, parent);
    for (const child of children) {
      paths.push(child.path);
      if (child.isParentPage) {
        queue.push(child.path);
      }
    }
  }

  // 2. Fetch contents with bounded concurrency, preserving order.
  const pages: IndexedWikiPage[] = new Array(paths.length);
  let cursor = 0;
  let loaded = 0;

  async function worker(): Promise<void> {
    while (cursor < paths.length) {
      const index = cursor++;
      const path = paths[index];
      try {
        const page = await client.getPage(wikiId, path);
        pages[index] = { path, title: titleFromPath(path), content: page.content };
      } catch {
        pages[index] = { path, title: titleFromPath(path), content: "" };
      }
      loaded += 1;
      onProgress?.(loaded, paths.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, paths.length) }, worker));
  return pages;
}

function titleFromPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}
