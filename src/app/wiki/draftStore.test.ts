import { afterEach, describe, expect, it } from "vitest";

import { clearDraft, loadDraft, saveDraft } from "./draftStore";

afterEach(() => {
  window.localStorage.clear();
});

describe("draftStore", () => {
  it("round-trips a saved draft", () => {
    saveDraft("wiki1", "/Home", "hello");
    const draft = loadDraft("wiki1", "/Home");
    expect(draft?.content).toBe("hello");
    expect(typeof draft?.savedAt).toBe("number");
  });

  it("keys drafts by wiki and path independently", () => {
    saveDraft("wiki1", "/Home", "a");
    saveDraft("wiki1", "/Other", "b");
    saveDraft("wiki2", "/Home", "c");
    expect(loadDraft("wiki1", "/Home")?.content).toBe("a");
    expect(loadDraft("wiki1", "/Other")?.content).toBe("b");
    expect(loadDraft("wiki2", "/Home")?.content).toBe("c");
  });

  it("returns undefined when there is no draft", () => {
    expect(loadDraft("wiki1", "/Missing")).toBeUndefined();
  });

  it("clears a draft", () => {
    saveDraft("wiki1", "/Home", "hello");
    clearDraft("wiki1", "/Home");
    expect(loadDraft("wiki1", "/Home")).toBeUndefined();
  });

  it("ignores malformed stored entries", () => {
    window.localStorage.setItem("powerwiki:draft:wiki1::/Home", "not json");
    expect(loadDraft("wiki1", "/Home")).toBeUndefined();
  });
});
