import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearMentionCache, searchMentions } from "./mentionCompletions";

const ADA = { id: "a502d9c7-0cbd-45de-9b3f-1c2d3e4f5a6b", displayName: "Ada Lovelace" };

beforeEach(() => {
  clearMentionCache();
});

describe("searchMentions", () => {
  it("searches once and reuses the result for the same query", async () => {
    const search = vi.fn().mockResolvedValue([ADA]);

    expect(await searchMentions("ada", search, 1000)).toEqual([ADA]);
    expect(await searchMentions("ada", search, 2000)).toEqual([ADA]);

    expect(search).toHaveBeenCalledTimes(1);
  });

  it("treats a query as the same regardless of case or surrounding space", async () => {
    const search = vi.fn().mockResolvedValue([ADA]);

    await searchMentions("Ada", search, 1000);
    await searchMentions("  ada ", search, 1000);

    expect(search).toHaveBeenCalledTimes(1);
  });

  it("searches again once the cached result has aged out", async () => {
    const search = vi.fn().mockResolvedValue([ADA]);

    await searchMentions("ada", search, 0);
    await searchMentions("ada", search, 31_000);

    expect(search).toHaveBeenCalledTimes(2);
  });

  it("searches from the first character, because an empty answer ends the session", async () => {
    const search = vi.fn().mockResolvedValue([ADA]);

    // Monaco stops asking a provider that returns nothing, so a "wait for two
    // characters" guard would kill the trigger rather than defer it.
    expect(await searchMentions("a", search)).toEqual([ADA]);
    expect(search).toHaveBeenCalledWith("a");
  });

  it("still does nothing for a bare @, so prose costs no round trip", async () => {
    const search = vi.fn().mockResolvedValue([ADA]);

    expect(await searchMentions("", search)).toEqual([]);
    expect(await searchMentions("   ", search)).toEqual([]);

    expect(search).not.toHaveBeenCalled();
  });

  it("does not cache a failure, so a blip does not blank the picker", async () => {
    const search = vi
      .fn()
      .mockRejectedValueOnce(new Error("identity service unavailable"))
      .mockResolvedValue([ADA]);

    await expect(searchMentions("ada", search, 1000)).rejects.toThrow("unavailable");
    expect(await searchMentions("ada", search, 1000)).toEqual([ADA]);

    expect(search).toHaveBeenCalledTimes(2);
  });

  it("caches an empty result, so a name nobody has is not asked for twice", async () => {
    const search = vi.fn().mockResolvedValue([]);

    expect(await searchMentions("zzz", search, 1000)).toEqual([]);
    expect(await searchMentions("zzz", search, 1000)).toEqual([]);

    expect(search).toHaveBeenCalledTimes(1);
  });

  it("keeps separate queries apart", async () => {
    const search = vi.fn(async (q: string) => (q === "ada" ? [ADA] : []));

    expect(await searchMentions("ada", search, 1000)).toEqual([ADA]);
    expect(await searchMentions("bob", search, 1000)).toEqual([]);

    expect(search).toHaveBeenCalledTimes(2);
  });
});
