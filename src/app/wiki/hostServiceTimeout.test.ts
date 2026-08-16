import { describe, expect, it, vi } from "vitest";

import { resolveWithinTimeout } from "./hostServiceTimeout";

describe("resolveWithinTimeout", () => {
  it("returns the value when the host answers in time", async () => {
    await expect(resolveWithinTimeout(Promise.resolve("service"), 1000)).resolves.toBe("service");
  });

  it("resolves undefined when the host rejects", async () => {
    await expect(
      resolveWithinTimeout(Promise.reject(new Error("no such service")), 1000)
    ).resolves.toBeUndefined();
  });

  it("resolves undefined when the promise never settles", async () => {
    vi.useFakeTimers();
    try {
      // This is the case that hung PowerWiki on "Loading wiki." forever: the SDK
      // handshake never completes outside a real hub, so getService() neither
      // resolves nor rejects.
      const never = new Promise<string>(() => {});
      const pending = resolveWithinTimeout(never, 3000);
      await vi.advanceTimersByTimeAsync(3000);
      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("prefers a late-but-in-time answer over the timeout", async () => {
    vi.useFakeTimers();
    try {
      const slow = new Promise<string>((resolve) => setTimeout(() => resolve("service"), 2999));
      const pending = resolveWithinTimeout(slow, 3000);
      await vi.advanceTimersByTimeAsync(2999);
      await expect(pending).resolves.toBe("service");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not leave a timer pending once the host answers", async () => {
    vi.useFakeTimers();
    try {
      await resolveWithinTimeout(Promise.resolve("service"), 60_000);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
