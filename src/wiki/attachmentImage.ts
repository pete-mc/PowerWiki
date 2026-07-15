import * as SDK from "azure-devops-extension-sdk";

// Wiki attachment images are served by the authenticated Azure DevOps Git Items
// API. A bare <img src> pointing at that API is a cross-origin request from the
// sandboxed extension iframe (gallerycdn.vsassets.io -> dev.azure.com), so it is
// sent without Azure DevOps credentials — the service then 302-redirects it to a
// sign-in page and the image never loads. Fetch the bytes with the extension's
// access token and hand back an object URL the <img> can display instead.
//
// Callers own the returned object URL and must URL.revokeObjectURL it when the
// image is no longer shown.
export async function fetchAttachmentObjectUrl(url: string): Promise<string> {
  const token = await SDK.getAccessToken();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error(`Image fetch failed: ${response.status}`);
  }
  return URL.createObjectURL(await response.blob());
}
