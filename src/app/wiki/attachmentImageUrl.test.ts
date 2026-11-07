import { describe, expect, it } from "vitest";

import { resolveAzureDevOpsImagePath } from "./WikiBrowser";

describe("resolveAzureDevOpsImagePath", () => {
  it("recognises an on-prem attachment URL from the current collection", () => {
    expect(resolveAzureDevOpsImagePath(
      "https://devops.example.local/DefaultCollection/Product/.attachments/a.png",
      "https://devops.example.local/DefaultCollection/Product/_git/Product.wiki"
    )).toBe("/.attachments/a.png");
  });

  it("recognises an on-prem attachment URL from the current wiki and removes its collection path", () => {
    const path = resolveAzureDevOpsImagePath(
      "https://devops.example.local/tfs/DefaultCollection/Product/.attachments/a%20b.png",
      "https://devops.example.local/tfs/DefaultCollection/Product/_git/Product.wiki"
    );

    expect(path).toBe("/.attachments/a b.png");
  });

  it("does not treat an attachment URL from another server as part of the wiki", () => {
    expect(resolveAzureDevOpsImagePath(
      "https://other.example.local/tfs/DefaultCollection/Product/.attachments/a.png",
      "https://devops.example.local/tfs/DefaultCollection/Product/_git/Product.wiki"
    )).toBeUndefined();
  });

  it("does not treat an attachment URL from another collection as part of the wiki", () => {
    expect(resolveAzureDevOpsImagePath(
      "https://devops.example.local/tfs/OtherCollection/Product/.attachments/a.png",
      "https://devops.example.local/tfs/DefaultCollection/Product/_git/Product.wiki"
    )).toBeUndefined();
  });

  it("recognises hosted Azure DevOps attachment URLs from the current wiki", () => {
    expect(resolveAzureDevOpsImagePath(
      "https://contoso.visualstudio.com/Product/.attachments/a.png",
      "https://contoso.visualstudio.com/Product/_git/Product.wiki"
    )).toBe("/.attachments/a.png");
  });

  it("recognises modern hosted Azure DevOps attachment URLs from the current wiki", () => {
    expect(resolveAzureDevOpsImagePath(
      "https://dev.azure.com/contoso/Product/.attachments/a.png",
      "https://dev.azure.com/contoso/Product/_git/Product.wiki"
    )).toBe("/.attachments/a.png");
  });

  it("continues to recognise hosted CDN attachment URLs", () => {
    expect(resolveAzureDevOpsImagePath(
      "https://contoso.vsassets.io/.attachments/a.png"
    )).toBe("/.attachments/a.png");
  });
});
