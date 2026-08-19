import { describe, expect, it } from "vitest";

import { buildGitItemUrl } from "./gitItemUrl";
import type { WikiSummary } from "./WikiPage";

const wiki: WikiSummary = {
  id: "wiki-id",
  name: "Product.wiki",
  repositoryId: "repo-id",
  remoteUrl: "https://dev.azure.com/contoso/Product/_git/Product.wiki"
};

// This builds the authenticated Items API URL that every attachment image in the
// Azure DevOps hub is fetched from. It has real branching in it — the API path
// differs between dev.azure.com and the legacy visualstudio.com hosts — and none
// of it was covered. When it is wrong, images silently fail to load.
describe("buildGitItemUrl", () => {
  it("builds an Items API URL for the file, on dev.azure.com", () => {
    const url = new URL(buildGitItemUrl(wiki, "Product", "/.attachments/a.png") ?? "");

    expect(url.origin).toBe("https://dev.azure.com");
    expect(url.pathname).toBe("/contoso/Product/_apis/git/repositories/repo-id/Items");
    expect(url.searchParams.get("path")).toBe("/.attachments/a.png");
    expect(url.searchParams.get("download")).toBe("true");
  });

  // On dev.azure.com the organisation is the first path segment, so it has to be
  // carried across to the API URL. On visualstudio.com it is the subdomain and
  // the path starts at the project, so adding a prefix would produce a 404.
  it("omits the organisation prefix on a legacy visualstudio.com host", () => {
    const legacy = { ...wiki, remoteUrl: "https://contoso.visualstudio.com/Product/_git/Product.wiki" };

    const url = new URL(buildGitItemUrl(legacy, "Product", "/.attachments/a.png") ?? "");

    expect(url.origin).toBe("https://contoso.visualstudio.com");
    expect(url.pathname).toBe("/Product/_apis/git/repositories/repo-id/Items");
  });

  it("resolves the path through the wiki's mapped path", () => {
    const mapped = { ...wiki, mappedPath: "/docs/Product.wiki" };

    const url = new URL(buildGitItemUrl(mapped, "Product", "/.attachments/a.png") ?? "");

    expect(url.searchParams.get("path")).toBe("/docs/Product.wiki/.attachments/a.png");
  });

  // Returning undefined is what makes the caller fall back rather than issue a
  // request that cannot work.
  it("returns undefined when the wiki does not identify a repository", () => {
    expect(buildGitItemUrl({ ...wiki, repositoryId: undefined }, "Product", "/a.png")).toBeUndefined();
    expect(buildGitItemUrl({ ...wiki, remoteUrl: undefined }, "Product", "/a.png")).toBeUndefined();
  });

  it("encodes a project or repository id that needs it", () => {
    const url = new URL(
      buildGitItemUrl({ ...wiki, repositoryId: "repo id/2" }, "My Project", "/a.png") ?? ""
    );

    expect(url.pathname).toContain("My%20Project");
    expect(url.pathname).toContain("repo%20id%2F2");
  });

  // The path is a query parameter, so a name with a space or an ampersand in it
  // has to survive as a value rather than splitting the query.
  it("keeps a path containing spaces and separators intact", () => {
    const url = new URL(buildGitItemUrl(wiki, "Product", "/.attachments/a b&c.png") ?? "");

    expect(url.searchParams.get("path")).toBe("/.attachments/a b&c.png");
  });
});
