import { describe, expect, it } from "vitest";

import { insideExistingMention, matchMentionTrigger, mentionMarkdown } from "./mentionTrigger";

describe("matchMentionTrigger", () => {
  it("triggers on an @ at the start of a line", () => {
    expect(matchMentionTrigger("@")).toEqual({ query: "", atIndex: 0 });
    expect(matchMentionTrigger("@ada")).toEqual({ query: "ada", atIndex: 0 });
  });

  it("triggers on an @ after whitespace", () => {
    expect(matchMentionTrigger("Ask @ada")).toEqual({ query: "ada", atIndex: 4 });
  });

  it("keeps matching across one space, because people have surnames", () => {
    expect(matchMentionTrigger("Ask @ada lov")).toEqual({ query: "ada lov", atIndex: 4 });
  });

  it("stops once the text past the @ reads as prose rather than a name", () => {
    expect(matchMentionTrigger("Ask @ada lovelace about the thing")).toBeNull();
  });

  it("does not trigger inside an email address", () => {
    expect(matchMentionTrigger("someone@example.com")).toBeNull();
    expect(matchMentionTrigger("mail someone@exa")).toBeNull();
  });

  it("does not trigger inside an unclosed code span", () => {
    expect(matchMentionTrigger("use `npm i @scope")).toBeNull();
    // Closed span: the @ afterwards is ordinary prose again.
    expect(matchMentionTrigger("use `npm i` then @ada")).toEqual({ query: "ada", atIndex: 17 });
  });

  it("gives up on a query too long to be a name", () => {
    expect(matchMentionTrigger(`@${"a".repeat(41)}`)).toBeNull();
  });

  it("accepts the punctuation that appears in real names", () => {
    expect(matchMentionTrigger("@o'brien")?.query).toBe("o'brien");
    expect(matchMentionTrigger("@jean-luc")?.query).toBe("jean-luc");
    expect(matchMentionTrigger("@ada.lovelace")?.query).toBe("ada.lovelace");
  });

  it("accepts non-ASCII names", () => {
    expect(matchMentionTrigger("@josé")?.query).toBe("josé");
    expect(matchMentionTrigger("@张伟")?.query).toBe("张伟");
  });

  it("reports the @ position so the completion can replace what was typed", () => {
    const trigger = matchMentionTrigger("Hello @ada");
    expect(trigger?.atIndex).toBe(6);
    expect("Hello @ada".charAt(trigger!.atIndex)).toBe("@");
  });
});

describe("insideExistingMention", () => {
  it("is true part-way through a written mention", () => {
    expect(insideExistingMention("Ask @<a502d9c7-0cbd")).toBe(true);
  });

  it("is false once the mention is closed", () => {
    expect(insideExistingMention("Ask @<a502d9c7-0cbd-45de-9b3f-1c2d3e4f5a6b>")).toBe(false);
  });

  it("is false for an ordinary trigger", () => {
    expect(insideExistingMention("Ask @ada")).toBe(false);
    expect(insideExistingMention("no at sign here")).toBe(false);
  });
});

describe("mentionMarkdown", () => {
  it("writes Azure DevOps' own mention format", () => {
    expect(mentionMarkdown("a502d9c7-0cbd-45de-9b3f-1c2d3e4f5a6b")).toBe(
      "@<a502d9c7-0cbd-45de-9b3f-1c2d3e4f5a6b>"
    );
  });
});
