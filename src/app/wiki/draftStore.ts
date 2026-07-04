// Local, best-effort autosave of in-progress page edits so an accidental reload
// or tab close doesn't lose work. Drafts live in localStorage keyed by wiki +
// page path; they are cleared once the edit is saved or explicitly discarded.

export interface StoredDraft {
  readonly content: string;
  /** Epoch milliseconds the draft was last autosaved. */
  readonly savedAt: number;
}

const PREFIX = "powerwiki:draft:";

function keyFor(wikiId: string, path: string): string {
  return `${PREFIX}${wikiId}::${path}`;
}

export function saveDraft(wikiId: string, path: string, content: string): void {
  try {
    const draft: StoredDraft = { content, savedAt: Date.now() };
    window.localStorage.setItem(keyFor(wikiId, path), JSON.stringify(draft));
  } catch {
    // localStorage may be unavailable or full — autosave is best-effort.
  }
}

export function loadDraft(wikiId: string, path: string): StoredDraft | undefined {
  try {
    const raw = window.localStorage.getItem(keyFor(wikiId, path));
    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (typeof parsed.content === "string" && typeof parsed.savedAt === "number") {
      return { content: parsed.content, savedAt: parsed.savedAt };
    }
  } catch {
    // Ignore malformed or inaccessible entries.
  }

  return undefined;
}

export function clearDraft(wikiId: string, path: string): void {
  try {
    window.localStorage.removeItem(keyFor(wikiId, path));
  } catch {
    // Ignore inaccessible storage.
  }
}
