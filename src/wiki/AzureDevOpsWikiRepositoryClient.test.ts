import { WikiType, type WikiV2 } from "azure-devops-extension-api/Wiki";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface RecordedRequest {
  readonly method?: string;
  readonly routeTemplate: string;
  readonly queryParams?: Record<string, unknown>;
}

const requests: RecordedRequest[] = [];
const wikis: WikiV2[] = [];
const getRepository = vi.fn();
const getWiki = vi.fn((_project: string, wikiId: string) =>
  Promise.resolve(wikis.find((wiki) => wiki.id === wikiId || wiki.name === wikiId))
);

// Every SDK client shares one fake transport: requests are recorded and answered
// with an empty page, so the test sees exactly what would go over the wire.
vi.mock("azure-devops-extension-api/Common", () => ({
  getClient: (clientClass: { prototype: object }) => {
    const client = Object.create(clientClass.prototype) as Record<string, unknown>;
    client.beginRequest = (request: RecordedRequest) => {
      requests.push(request);
      return Promise.resolve(new Response("{}", { headers: { etag: "\"v2\"" } }));
    };
    client.getAllWikis = () => Promise.resolve(wikis);
    client.getWiki = getWiki;
    client.getRepository = getRepository;
    return client;
  },
}));

const { AzureDevOpsWikiRepositoryClient, wikiBranch } = await import("./AzureDevOpsWikiRepositoryClient");
const { wikiAttachmentPath } = await import("./attachmentPath");

const codeWiki = {
  id: "code-wiki-id",
  name: "Example_Project",
  type: WikiType.CodeWiki,
  versions: [{ version: "main" }],
} as WikiV2;

const projectWiki = {
  id: "project-wiki-id",
  name: "example-project.wiki",
  type: WikiType.ProjectWiki,
  versions: [{ version: "wikiMaster" }],
} as WikiV2;

const mainBranch = { versionDescriptor: { version: "main", versionType: "branch" } };

/** Runs every page operation against a wiki and returns the requests it made. */
async function pageRequests(client: InstanceType<typeof AzureDevOpsWikiRepositoryClient>, wikiId: string) {
  await client.getAllPages(wikiId);
  await client.getChildPages(wikiId, "/");
  await client.getPage(wikiId, "/Home");
  await client.getPageMeta(wikiId, "/Home");
  await client.createPage(wikiId, "/New page", "# New");
  await client.savePage(wikiId, { content: "# Edited", path: "/Home", version: "\"v1\"" });
  await client.movePage(wikiId, "/New page", "/Moved page", 0);
  await client.deletePage(wikiId, "/Moved page");
  await client.createAttachment(wikiId, "image.png", "AAAA").catch(() => undefined);
  return requests.splice(0);
}

describe("AzureDevOpsWikiRepositoryClient page branch", () => {
  beforeEach(() => {
    requests.length = 0;
    wikis.splice(0, wikis.length, codeWiki, projectWiki);
    getWiki.mockClear();
    getRepository.mockReset();
    getRepository.mockResolvedValue({ remoteUrl: "https://dev.azure.com/Example/Example/_git/example-project.wiki" });
  });

  // Issue #85: a code wiki rejected every write with "The versionType should
  // be 'branch' and version cannot be null" because none named the branch.
  it("names the published branch on every page request to a code wiki", async () => {
    const client = new AzureDevOpsWikiRepositoryClient("Example");
    await client.getWikis();

    const sent = await pageRequests(client, codeWiki.id);

    expect(sent).toHaveLength(9);
    for (const request of sent) {
      expect(request.queryParams, `${request.method ?? "GET"} ${request.routeTemplate}`).toMatchObject(mainBranch);
    }
    expect(getWiki).not.toHaveBeenCalled();
  });

  it("leaves project wiki requests without a branch, as before", async () => {
    const client = new AzureDevOpsWikiRepositoryClient("Example");
    await client.getWikis();

    for (const request of await pageRequests(client, projectWiki.id)) {
      expect(request.queryParams ?? {}).not.toHaveProperty("versionDescriptor");
    }
  });

  it("looks the wiki up once when its pages are used before the wiki list", async () => {
    const client = new AzureDevOpsWikiRepositoryClient("Example");

    await client.createPage(codeWiki.name, "/New page");
    await client.savePage(codeWiki.name, { content: "", path: "/New page" });

    expect(requests.map((request) => request.queryParams)).toEqual([
      expect.objectContaining(mainBranch),
      expect.objectContaining(mainBranch),
    ]);
    expect(getWiki).toHaveBeenCalledTimes(1);
  });
});

describe("wiki repository URLs", () => {
  beforeEach(() => {
    wikis.splice(0, wikis.length, projectWiki);
    getRepository.mockReset();
    getRepository.mockResolvedValue({ remoteUrl: "http://server/DefaultCollection/Example/_git/example-project.wiki" });
  });

  it("uses the backing repository URL separately from the wiki API URL", async () => {
    const client = new AzureDevOpsWikiRepositoryClient("Example");

    const [wiki] = await client.getWikis();

    expect(wiki.repositoryRemoteUrl).toBe("http://server/DefaultCollection/Example/_git/example-project.wiki");
    expect(getRepository).toHaveBeenCalledWith(projectWiki.id, "Example");
  });
});

describe("wikiBranch", () => {
  it("is the first published version of a code wiki", () => {
    expect(wikiBranch(codeWiki)).toEqual({ version: "main", versionType: "branch" });
  });

  it("is undefined for a project wiki", () => {
    expect(wikiBranch(projectWiki)).toBeUndefined();
  });

  it("is undefined for a code wiki with no published version", () => {
    expect(wikiBranch({ ...codeWiki, versions: [] })).toBeUndefined();
  });
});

describe("wikiAttachmentPath", () => {
  it("keeps a project wiki's path", () => {
    expect(wikiAttachmentPath("/.attachments/image-1.png")).toBe("/.attachments/image-1.png");
  });

  // Measured on a code wiki mapped to /docs: the API answers with the
  // repository path, which would render as /docs/docs/.attachments/….
  it("drops a code wiki's mapped folder", () => {
    expect(wikiAttachmentPath("/docs/.attachments/image-1.png")).toBe("/.attachments/image-1.png");
    expect(wikiAttachmentPath("/team/docs/.attachments/image-1.png")).toBe("/.attachments/image-1.png");
  });
});
