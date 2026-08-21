// The work item form's linked-pages provider, against a fake form service.
//
// The Azure DevOps SDK is stubbed rather than the provider: what is worth
// checking is which *form service* calls come out the other side, because that
// is the whole reason this class exists. Going through the open form instead of
// the REST API is what keeps linking and unlinking free of `vso.work_write`,
// and what leaves the work item dirty so the user saves as usual — a `save()`
// creeping in here would be a permissions and undo regression that no type
// would catch.

import { beforeEach, describe, expect, it, vi } from "vitest";

const service = {
  getWorkItemRelations: vi.fn(),
  addWorkItemRelations: vi.fn(),
  removeWorkItemRelations: vi.fn(),
  save: vi.fn(),
};

vi.mock("azure-devops-extension-sdk", () => ({
  getService: () => Promise.resolve(service),
}));

const { WorkItemFormLinkedPages } = await import("./workItemFormLinkedPages");
const { buildWikiArtifactUrl } = await import("./workItemWikiLinks");

const PROJECT = "adf21ddb-12ae-4355-924a-8121484e984e";
const WIKI = "fec63798-8c2b-45b3-921a-2396ea48c13d";

function wikiRelation(path: string, extras: Record<string, unknown> = {}) {
  return {
    rel: "ArtifactLink",
    url: buildWikiArtifactUrl({ projectId: PROJECT, wikiId: WIKI, path }),
    // A real relation carries more than PowerWiki wrote: the service adds its
    // own attributes, and they are why removal has to hand back the object it
    // was given rather than one rebuilt from the path.
    attributes: { name: "Wiki Page", id: 4242, ...extras },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  service.getWorkItemRelations.mockResolvedValue([]);
  service.addWorkItemRelations.mockResolvedValue(undefined);
  service.removeWorkItemRelations.mockResolvedValue(undefined);
});

describe("WorkItemFormLinkedPages.list", () => {
  it("reports the wiki page links and ignores every other relation", async () => {
    service.getWorkItemRelations.mockResolvedValue([
      wikiRelation("/Guides/Alpha", { comment: "Design notes" }),
      { rel: "ArtifactLink", url: "vstfs:///Git/Commit/abc", attributes: { name: "Fixed in Commit" } },
      { rel: "System.LinkTypes.Hierarchy-Forward", url: "https://example/1" },
    ]);

    expect(await new WorkItemFormLinkedPages(PROJECT).list()).toEqual([
      { projectId: PROJECT, wikiId: WIKI, path: "/Guides/Alpha", comment: "Design notes" },
    ]);
  });
});

describe("WorkItemFormLinkedPages.add", () => {
  it("adds the relation to the open form without saving it", async () => {
    await new WorkItemFormLinkedPages(PROJECT).add({ wikiId: WIKI, path: "/Guides/Alpha" });

    expect(service.addWorkItemRelations).toHaveBeenCalledTimes(1);
    const [added] = service.addWorkItemRelations.mock.calls[0][0] as { url: string; rel: string }[];
    expect(added.rel).toBe("ArtifactLink");
    expect(added.url).toBe(buildWikiArtifactUrl({ projectId: PROJECT, wikiId: WIKI, path: "/Guides/Alpha" }));
    expect(service.save).not.toHaveBeenCalled();
  });

  it("explains a duplicate rather than letting Azure DevOps reject it", async () => {
    service.getWorkItemRelations.mockResolvedValue([wikiRelation("/Guides/Alpha")]);

    await expect(
      new WorkItemFormLinkedPages(PROJECT).add({ wikiId: WIKI, path: "/Guides/Alpha" })
    ).rejects.toThrow("already linked");
    expect(service.addWorkItemRelations).not.toHaveBeenCalled();
  });
});

describe("WorkItemFormLinkedPages.remove", () => {
  it("removes the exact relation objects the form service reported", async () => {
    const target = wikiRelation("/Guides/Alpha");
    const keep = wikiRelation("/Guides/Beta");
    service.getWorkItemRelations.mockResolvedValue([keep, target]);

    await new WorkItemFormLinkedPages(PROJECT).remove({ path: "/Guides/Alpha" });

    expect(service.removeWorkItemRelations).toHaveBeenCalledTimes(1);
    // Identity, not equality: a rebuilt relation would be missing `id` and the
    // service would quietly remove nothing.
    expect(service.removeWorkItemRelations.mock.calls[0][0]).toEqual([target]);
    expect(service.removeWorkItemRelations.mock.calls[0][0][0]).toBe(target);
  });

  it("leaves the work item dirty rather than saving it", async () => {
    service.getWorkItemRelations.mockResolvedValue([wikiRelation("/Guides/Alpha")]);

    await new WorkItemFormLinkedPages(PROJECT).remove({ path: "/Guides/Alpha" });

    expect(service.save).not.toHaveBeenCalled();
  });

  it("removes every duplicate link to the same page", async () => {
    const first = wikiRelation("/Guides/Alpha");
    const second = wikiRelation("/Guides/Alpha", { comment: "linked twice" });
    service.getWorkItemRelations.mockResolvedValue([first, second]);

    await new WorkItemFormLinkedPages(PROJECT).remove({ path: "/Guides/Alpha" });

    expect(service.removeWorkItemRelations.mock.calls[0][0]).toEqual([first, second]);
  });

  it("says so when the link has already gone, rather than removing nothing", async () => {
    service.getWorkItemRelations.mockResolvedValue([wikiRelation("/Guides/Beta")]);

    await expect(new WorkItemFormLinkedPages(PROJECT).remove({ path: "/Guides/Alpha" })).rejects.toThrow(
      "no longer linked"
    );
    expect(service.removeWorkItemRelations).not.toHaveBeenCalled();
  });
});
