import {
  CommentSortOrder,
  type Comment as ApiComment,
  type CommentCreateParameters
} from "azure-devops-extension-api/Comments";
import { getClient } from "azure-devops-extension-api/Common";
import {
  GitRestClient,
  GitVersionOptions,
  GitVersionType,
  VersionControlRecursionType,
  type GitCommitRef,
  type GitQueryCommitsCriteria,
  type GitVersionDescriptor
} from "azure-devops-extension-api/Git";
import {
  WikiRestClient,
  type WikiPage as WikiApiPage,
  type WikiPageMove
} from "azure-devops-extension-api/Wiki";

import type { WikiComment, WikiPageChange, WikiPageMeta, WikiPageRevision } from "./WikiComment";
import {
  alreadyVisited,
  findRenameHop,
  MAX_RENAME_HOPS,
  type RenameCandidateChange
} from "./renameHistory";
import type { WikiAttachment, WikiPage, WikiPageSummary, WikiSummary } from "./WikiPage";
import type { WikiRepositoryClient } from "./WikiRepositoryClient";

/**
 * The version descriptor shape the commits criteria accepts. Declared locally
 * because the criteria itself is cast (the generated type omits itemVersion).
 */
type GitVersionDescriptorLike = Pick<GitVersionDescriptor, "version" | "versionOptions" | "versionType">;

interface WikiWithRepositoryFallback {
  readonly repository?: {
    readonly id?: string;
  };
}

/** The wiki attachments endpoint returns the file directly, or wrapped. */
interface WikiAttachmentBody {
  readonly name?: string;
  readonly path?: string;
  readonly attachment?: { readonly name?: string; readonly path?: string };
}

// Subclasses WikiRestClient to expose the same pages endpoint but requesting
// JSON instead of text/plain, which returns the full WikiPage object including
// subPages, order, and isParentPage.
class WikiJsonClient extends WikiRestClient {
  public getPageJson(
    project: string,
    wikiIdentifier: string,
    path: string
  ): Promise<WikiApiPage> {
    return this.beginRequest<WikiApiPage>({
      apiVersion: "5.2-preview.1",
      routeTemplate: "{project}/_apis/wiki/wikis/{wikiIdentifier}/pages",
      routeValues: { project, wikiIdentifier },
      queryParams: {
        path,
        recursionLevel: VersionControlRecursionType.OneLevel,
        includeContent: false,
      },
    });
  }

  public getPageTreeJson(
    project: string,
    wikiIdentifier: string
  ): Promise<WikiApiPage> {
    return this.beginRequest<WikiApiPage>({
      apiVersion: "5.2-preview.1",
      routeTemplate: "{project}/_apis/wiki/wikis/{wikiIdentifier}/pages",
      routeValues: { project, wikiIdentifier },
      queryParams: {
        path: "/",
        recursionLevel: VersionControlRecursionType.Full,
        includeContent: false,
      },
    });
  }

  public async getPageTextWithVersion(
    project: string,
    wikiIdentifier: string,
    path: string
  ): Promise<{ content: string; version?: string }> {
    const response = await this.beginRequest<Response>({
      apiVersion: "5.2-preview.1",
      httpResponseType: "text/plain",
      returnRawResponse: true,
      routeTemplate: "{project}/_apis/wiki/wikis/{wikiIdentifier}/pages/{*path}",
      routeValues: { project, wikiIdentifier },
      queryParams: {
        path,
        recursionLevel: VersionControlRecursionType.None,
      },
    });

    return {
      content: await response.text(),
      version: parseETag(response.headers.get("etag")),
    };
  }

  public getPageMetaJson(
    project: string,
    wikiIdentifier: string,
    path: string
  ): Promise<WikiApiPage> {
    return this.beginRequest<WikiApiPage>({
      apiVersion: "5.2-preview.1",
      routeTemplate: "{project}/_apis/wiki/wikis/{wikiIdentifier}/pages",
      routeValues: { project, wikiIdentifier },
      queryParams: {
        path,
        recursionLevel: VersionControlRecursionType.None,
        includeContent: false,
      },
    });
  }

  public async savePage(
    project: string,
    wikiIdentifier: string,
    page: WikiPage
  ): Promise<WikiPage> {
    const customHeaders: Record<string, string> = {};
    if (page.version) {
      customHeaders["If-Match"] = page.version;
    }

    const response = await this.beginRequest<Response>({
      apiVersion: "5.2-preview.1",
      customHeaders,
      method: "PUT",
      returnRawResponse: true,
      routeTemplate: "{project}/_apis/wiki/wikis/{wikiIdentifier}/pages/{*path}",
      routeValues: { project, wikiIdentifier },
      queryParams: {
        path: page.path,
      },
      body: {
        content: page.content,
      },
    });
    // The pages PUT endpoint returns the WikiPage object directly as the body;
    // the new version comes back in the ETag response header (the {page, eTag}
    // WikiPageResponse wrapper is only synthesised by the SDK's own clients).
    const saved = await response.json() as WikiApiPage;

    return {
      content: saved.content ?? page.content,
      id: saved.id,
      path: saved.path ?? page.path,
      version: parseETag(response.headers.get("etag")) ?? page.version,
    };
  }

  public async createPage(
    project: string,
    wikiIdentifier: string,
    path: string,
    content: string
  ): Promise<WikiPage> {
    const response = await this.beginRequest<Response>({
      apiVersion: "5.2-preview.1",
      method: "PUT",
      returnRawResponse: true,
      routeTemplate: "{project}/_apis/wiki/wikis/{wikiIdentifier}/pages/{*path}",
      routeValues: { project, wikiIdentifier },
      queryParams: { path },
      body: { content },
    });
    const saved = await response.json() as WikiApiPage;

    return {
      content: saved.content ?? content,
      id: saved.id,
      path: saved.path ?? path,
      version: parseETag(response.headers.get("etag")),
    };
  }

  public async deletePage(
    project: string,
    wikiIdentifier: string,
    path: string
  ): Promise<void> {
    await this.beginRequest<Response>({
      apiVersion: "5.2-preview.1",
      method: "DELETE",
      returnRawResponse: true,
      routeTemplate: "{project}/_apis/wiki/wikis/{wikiIdentifier}/pages/{*path}",
      routeValues: { project, wikiIdentifier },
      queryParams: { path },
    });
  }

  public async createAttachment(
    project: string,
    wikiIdentifier: string,
    name: string,
    base64Content: string
  ): Promise<WikiAttachment> {
    // The generated SDK client only exposes comment attachments, so call the
    // wiki attachments endpoint directly. The API expects the file bytes
    // base64-encoded in the raw request body (isRawData bypasses JSON
    // serialization) and returns the stored name and "/.attachments/…" path.
    const response = await this.beginRequest<WikiAttachmentBody>({
      apiVersion: "7.1",
      method: "PUT",
      isRawData: true,
      customHeaders: { "Content-Type": "application/octet-stream" },
      routeTemplate: "{project}/_apis/wiki/wikis/{wikiIdentifier}/attachments",
      routeValues: { project, wikiIdentifier },
      queryParams: { name },
      body: base64Content,
    });

    // The raw endpoint returns the WikiAttachment ({ name, path }) directly;
    // some API versions wrap it as { attachment: {...} }, so handle both.
    const attachment = response.attachment ?? response;
    if (!attachment?.name || !attachment?.path) {
      throw new Error("The wiki attachments API returned an unexpected response.");
    }
    return { name: attachment.name, path: attachment.path };
  }

  public async movePage(
    project: string,
    wikiIdentifier: string,
    path: string,
    newPath: string,
    newOrder: number
  ): Promise<WikiPage> {
    const response = await this.beginRequest<Response>({
      apiVersion: "5.2-preview.1",
      method: "POST",
      returnRawResponse: true,
      routeTemplate: "{project}/_apis/wiki/wikis/{wikiIdentifier}/pageMoves",
      routeValues: { project, wikiIdentifier },
      body: { path, newPath, newOrder },
    });
    const moved = await response.json() as WikiPageMove;

    return {
      content: moved.page?.content ?? "",
      id: moved.page?.id,
      path: moved.page?.path ?? newPath,
      version: parseETag(response.headers.get("etag")),
    };
  }
}

export class AzureDevOpsWikiRepositoryClient implements WikiRepositoryClient {
  private readonly wikiClient = getClient(WikiRestClient);
  private readonly wikiJsonClient = getClient(WikiJsonClient);
  private readonly gitClient = getClient(GitRestClient);

  public constructor(private readonly projectName: string) {}

  public async getWikis(): Promise<WikiSummary[]> {
    const wikis = await this.wikiClient.getAllWikis(this.projectName);

    return wikis.map((wiki) => ({
      id: wiki.id,
      mappedPath: normalizeMappedPath(wiki.mappedPath),
      name: wiki.name,
      repositoryId: wiki.repositoryId ?? (wiki as WikiWithRepositoryFallback).repository?.id ?? wiki.id,
      remoteUrl: wiki.remoteUrl,
      version: wiki.versions?.[0]?.version,
    }));
  }

  public async getAllPages(wikiId: string): Promise<WikiPageSummary[]> {
    const root = await this.wikiJsonClient.getPageTreeJson(this.projectName, wikiId);
    const pages: WikiPageSummary[] = [];

    const collect = (page: WikiApiPage) => {
      for (const subPage of page.subPages ?? []) {
        pages.push({
          id: subPage.id,
          isParentPage: subPage.isParentPage ?? false,
          order: subPage.order ?? 0,
          path: subPage.path,
        });
        collect(subPage);
      }
    };

    collect(root);
    return pages;
  }

  public async getChildPages(wikiId: string, parentPath: string): Promise<WikiPageSummary[]> {
    const page = await this.wikiJsonClient.getPageJson(this.projectName, wikiId, parentPath);

    return (page.subPages ?? []).map((subPage: WikiApiPage) => ({
      id: subPage.id,
      isParentPage: subPage.isParentPage ?? false,
      order: subPage.order ?? 0,
      path: subPage.path,
    }));
  }

  public async getPage(wikiId: string, path: string): Promise<WikiPage> {
    const page = await this.wikiJsonClient.getPageTextWithVersion(
      this.projectName,
      wikiId,
      path
    );

    return { content: page.content, path, version: page.version };
  }

  public async savePage(wikiId: string, page: WikiPage): Promise<WikiPage> {
    return this.wikiJsonClient.savePage(this.projectName, wikiId, page);
  }

  public async createPage(wikiId: string, path: string, content = ""): Promise<WikiPage> {
    return this.wikiJsonClient.createPage(this.projectName, wikiId, path, content);
  }

  public async deletePage(wikiId: string, path: string): Promise<void> {
    return this.wikiJsonClient.deletePage(this.projectName, wikiId, path);
  }

  public async movePage(
    wikiId: string,
    path: string,
    newPath: string,
    newOrder: number
  ): Promise<WikiPage> {
    return this.wikiJsonClient.movePage(this.projectName, wikiId, path, newPath, newOrder);
  }

  public async createAttachment(wikiId: string, name: string, base64Content: string): Promise<WikiAttachment> {
    return this.wikiJsonClient.createAttachment(this.projectName, wikiId, name, base64Content);
  }

  public async getPageMeta(wikiId: string, path: string): Promise<WikiPageMeta> {
    const page = await this.wikiJsonClient.getPageMetaJson(this.projectName, wikiId, path);
    return { id: page.id, gitItemPath: page.gitItemPath };
  }

  public async getPageLastChange(
    repositoryId: string,
    gitItemPath: string,
    branch?: string
  ): Promise<WikiPageChange | undefined> {
    // Wiki repositories serve from a dedicated branch (e.g. "wikiMaster"). The
    // commits query returns nothing for an itemPath unless that branch is named
    // explicitly via itemVersion, which is the root cause of a missing byline.
    const itemVersion = branch
      ? {
          version: branch,
          versionOptions: GitVersionOptions.None,
          versionType: GitVersionType.Branch,
        }
      : undefined;

    for (const candidatePath of gitItemPathCandidates(gitItemPath)) {
      try {
        const criteria = {
          $skip: 0,
          $top: 1,
          itemPath: candidatePath,
          itemVersion,
        } as unknown as GitQueryCommitsCriteria;
        const commits = await this.gitClient.getCommitsBatch(criteria, repositoryId, this.projectName, 0, 1, false);
        const latest = commits[0];
        if (!latest) {
          continue;
        }

        const change = latest.author ?? latest.committer;
        return {
          authorName: change?.name,
          date: change?.date ? new Date(change.date).toISOString() : undefined,
        };
      } catch {
        // Try the next candidate path before giving up.
      }
    }

    return undefined;
  }

  /**
   * Lists a page's revisions: the Git commits that touched its file, newest
   * first. Tries hyphen/space path variants like the byline does.
   *
   * History is followed back through renames, matching the built-in wiki. The
   * commits API has no `git log --follow`, so once a path's own history runs
   * out this walks the rename recorded on its oldest commit and continues under
   * the previous path (see renameHistory). Each revision carries the path that
   * was valid at its commit, which is what lets restore read the right file.
   */
  public async getPageRevisions(
    repositoryId: string,
    gitItemPath: string,
    branch?: string,
    top = 50
  ): Promise<WikiPageRevision[]> {
    const branchVersion = branch
      ? {
          version: branch,
          versionOptions: GitVersionOptions.None,
          versionType: GitVersionType.Branch,
        }
      : undefined;

    for (const candidatePath of gitItemPathCandidates(gitItemPath)) {
      const revisions = await this.collectRevisions(repositoryId, candidatePath, branchVersion, top);
      if (revisions.length > 0) {
        return revisions;
      }
    }

    return [];
  }

  /**
   * Walks one path's commits, then hops to the pre-rename path and continues,
   * until the requested number of revisions is reached or the trail ends.
   */
  private async collectRevisions(
    repositoryId: string,
    startPath: string,
    branchVersion: GitVersionDescriptorLike | undefined,
    top: number
  ): Promise<WikiPageRevision[]> {
    const revisions: WikiPageRevision[] = [];
    const visited: string[] = [];
    let path = startPath;
    // Where to look for `path`: the branch tip first, then (after a rename hop)
    // the commit where that older path still existed.
    let version = branchVersion;

    for (let hop = 0; hop <= MAX_RENAME_HOPS; hop += 1) {
      if (alreadyVisited(visited, path)) {
        break;
      }
      visited.push(path);

      const remaining = top - revisions.length;
      if (remaining <= 0) {
        break;
      }

      let commits: GitCommitRef[];
      try {
        const criteria = {
          $skip: 0,
          $top: remaining,
          itemPath: path,
          itemVersion: version,
        } as unknown as GitQueryCommitsCriteria;
        commits = await this.gitClient.getCommitsBatch(
          criteria,
          repositoryId,
          this.projectName,
          0,
          remaining,
          false
        );
      } catch {
        break;
      }

      if (commits.length === 0) {
        break;
      }

      const pathAtThisPoint = path;
      for (const commit of commits) {
        const change = commit.author ?? commit.committer;
        revisions.push({
          commitId: commit.commitId,
          authorName: change?.name,
          date: change?.date ? new Date(change.date).toISOString() : undefined,
          comment: commit.comment,
          gitItemPath: pathAtThisPoint,
        });
      }

      // The oldest commit returned is where this path began — either the page
      // was created, or it was renamed into place from somewhere else.
      const oldest = commits[commits.length - 1];
      const previous = await this.findPreviousPath(repositoryId, oldest.commitId, pathAtThisPoint);
      if (!previous) {
        break;
      }

      path = previous.previousPath;
      version = {
        version: previous.parentCommitId,
        versionOptions: GitVersionOptions.None,
        versionType: GitVersionType.Commit,
      };
    }

    return revisions;
  }

  /**
   * If `commitId` renamed `path` into place, returns the path it had before and
   * the parent commit to search it under (the old path no longer exists at the
   * branch tip, so it can only be queried as of a commit that predates the
   * rename). Returns undefined for any commit that isn't such a rename.
   */
  private async findPreviousPath(
    repositoryId: string,
    commitId: string,
    path: string
  ): Promise<{ previousPath: string; parentCommitId: string } | undefined> {
    try {
      const changes = await this.gitClient.getChanges(commitId, repositoryId, this.projectName);
      const hop = findRenameHop((changes.changes ?? []) as RenameCandidateChange[], path);
      if (!hop) {
        return undefined;
      }

      const commit = await this.gitClient.getCommit(commitId, repositoryId, this.projectName);
      const parentCommitId = commit.parents?.[0];
      if (!parentCommitId) {
        // A rename in the very first commit has no earlier history to show.
        return undefined;
      }

      return { previousPath: hop.previousPath, parentCommitId };
    } catch {
      // History before the rename is a bonus; never fail the whole list for it.
      return undefined;
    }
  }

  /** Reads a page's Markdown as it was at a specific commit. */
  public async getPageContentAtCommit(
    repositoryId: string,
    gitItemPath: string,
    commitId: string
  ): Promise<string> {
    return this.gitClient.getItemText(
      repositoryId,
      gitItemPath,
      this.projectName,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      {
        version: commitId,
        versionOptions: GitVersionOptions.None,
        versionType: GitVersionType.Commit,
      },
      true
    );
  }

  /**
   * Lists the wiki's stored attachments (the `.attachments` folder in its
   * backing repository). Returns an empty list when the folder doesn't exist.
   */
  public async listAttachments(repositoryId: string, mappedPath: string | undefined): Promise<WikiAttachment[]> {
    const base = !mappedPath || mappedPath === "/" ? "" : mappedPath.replace(/\/+$/, "");
    const scopePath = `${base}/.attachments`;
    try {
      const items = await this.gitClient.getItems(
        repositoryId,
        this.projectName,
        scopePath,
        VersionControlRecursionType.OneLevel
      );
      return items
        .filter((item) => !item.isFolder)
        .map((item) => {
          const name = item.path.split("/").filter(Boolean).at(-1) ?? item.path;
          return { name, path: `/.attachments/${name}` };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  /**
   * Fetches the raw bytes of a repository item (e.g. an image attachment) via
   * the authenticated Git client, used to embed images into exported documents.
   * Wiki attachments resolve on the repository's default branch, so no version
   * descriptor is needed.
   */
  public async getItemBytes(repositoryId: string, repoPath: string): Promise<ArrayBuffer> {
    return this.gitClient.getItemContent(
      repositoryId,
      repoPath,
      this.projectName,
      undefined,
      undefined,
      undefined,
      undefined,
      true // download: return the raw content
    );
  }

  public async listComments(wikiId: string, pageId: number): Promise<WikiComment[]> {
    const result = await this.wikiClient.listComments(
      this.projectName,
      wikiId,
      pageId,
      undefined,
      undefined,
      true,
      undefined,
      CommentSortOrder.Asc
    );
    return (result.comments ?? [])
      .filter((comment) => !comment.isDeleted)
      .map((comment) => toWikiComment(comment));
  }

  public async addComment(wikiId: string, pageId: number, text: string): Promise<WikiComment> {
    // The generated SDK type requires parentId, but Azure DevOps rejects
    // parentId:0 for new top-level page comments.
    const request = { text } as CommentCreateParameters;
    const created = await this.wikiClient.addComment(request, this.projectName, wikiId, pageId);
    return toWikiComment(created);
  }
}

function gitItemPathCandidates(gitItemPath: string): string[] {
  const normalized = gitItemPath.startsWith("/") ? gitItemPath : `/${gitItemPath}`;
  const candidates = new Set<string>([normalized]);

  if (!normalized.endsWith(".md")) {
    candidates.add(`${normalized}.md`);
    if (normalized.endsWith("/")) {
      candidates.add(`${normalized}index.md`);
    } else {
      candidates.add(`${normalized}/index.md`);
    }
  }

  return Array.from(candidates);
}

function toWikiComment(comment: ApiComment): WikiComment {
  return {
    authorImageUrl: comment.createdBy?.imageUrl,
    authorName: comment.createdBy?.displayName,
    createdDate: comment.createdDate ? new Date(comment.createdDate).toISOString() : undefined,
    id: comment.id,
    parentId: comment.parentId,
    text: comment.text,
  };
}

function normalizeMappedPath(mappedPath: string | undefined): string {
  if (!mappedPath || mappedPath === "$/") {
    return "/";
  }

  return mappedPath.startsWith("/") ? mappedPath : `/${mappedPath}`;
}

function parseETag(value: string | null): string | undefined {
  return value?.split(",")[0]?.trim();
}
