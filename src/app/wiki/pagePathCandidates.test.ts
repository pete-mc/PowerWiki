import { describe, expect, it } from "vitest";

import { pagePathCandidates } from "./WikiBrowser";

// GitHub #29: a link to a page whose title contains a hyphen surrounded by
// spaces — "List - Firewall rules" — could not be opened.
//
// Azure DevOps stores a space as `-` in the file name, so a title that really
// contains a hyphen has it escaped as `%2D`. Decoding percent-escapes first
// turns that escape into an ordinary hyphen, after which the space substitution
// cannot tell the three hyphens apart and the page becomes
// "List   Firewall rules". The two substitutions have to happen in one pass.
describe("pagePathCandidates", () => {
  it("resolves a title containing a hyphen and spaces (GitHub #29)", () => {
    const candidates = pagePathCandidates("/Space-Home/Networks/List-%2D-Firewall-rules/DevOps");

    expect(candidates).toContain("/Space Home/Networks/List - Firewall rules/DevOps");
  });

  // Before the fix these were the only two readings offered, and the page is
  // neither of them: the literal one (which 404s) and the legacy fallback that
  // turned the escaped hyphen into a third space. Both are still tried — the
  // literal first, deliberately — but the correct reading now sits between
  // them, so it wins before the fallback can produce nonsense.
  it("puts the correct reading ahead of the reading that produced the bug", () => {
    const candidates = pagePathCandidates("/Test-Home/Test/Test-%2D-A-subpage");

    const correct = candidates.indexOf("/Test Home/Test/Test - A subpage");
    const wrong = candidates.indexOf("/Test Home/Test/Test   A subpage");

    expect(correct).toBeGreaterThanOrEqual(0);
    expect(wrong).toBeGreaterThan(correct);
  });

  it("still resolves an ordinary file-name link", () => {
    expect(pagePathCandidates("/Getting-Started")).toContain("/Getting Started");
  });

  // A link written as the page title, with or without URL encoding, must keep
  // working — that is the common case and the first candidate.
  it("still resolves a link written as the page title", () => {
    expect(pagePathCandidates("/Getting Started")[0]).toBe("/Getting Started");
    expect(pagePathCandidates("/Getting%20Started")[0]).toBe("/Getting Started");
  });

  // A page genuinely called "Well-known" should not be beaten to the request by
  // the file-name reading of the same string, which is "Well known".
  it("prefers the literal reading over the file-name reading", () => {
    const candidates = pagePathCandidates("/Well-known");

    expect(candidates[0]).toBe("/Well-known");
    expect(candidates).toContain("/Well known");
  });

  it("does not offer the same path twice", () => {
    const candidates = pagePathCandidates("/Home");

    expect(new Set(candidates).size).toBe(candidates.length);
  });
});
