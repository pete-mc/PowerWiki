import { describe, expect, it } from "vitest";

import { normalizeIdentityName } from "./AzureDevOpsIdentityClient";

describe("normalizeIdentityName", () => {
  it("strips the scope prefix Azure DevOps puts on group names", () => {
    expect(normalizeIdentityName("[dataversepowertools]\\dataversepowertools Team")).toBe(
      "dataversepowertools Team"
    );
  });

  it("leaves a person's name alone", () => {
    expect(normalizeIdentityName("Peter McDonald")).toBe("Peter McDonald");
  });

  it("keeps square brackets that are part of the name", () => {
    expect(normalizeIdentityName("Ops [on call]")).toBe("Ops [on call]");
  });

  it("returns an empty string for a missing name", () => {
    expect(normalizeIdentityName(undefined)).toBe("");
  });
});
