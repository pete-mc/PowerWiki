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
  return URL.createObjectURL(await fetchAttachmentBlob(url));
}

/**
 * Fetches an attachment as a base64 data URL. The draw.io editor is handed a
 * stored diagram as a data URL (it reads the diagram XML back out of the PNG's
 * metadata), and an object URL won't do: the editor iframe is a different
 * origin and cannot resolve a blob: URL minted here.
 */
export async function fetchAttachmentDataUrl(url: string): Promise<string> {
  const blob = await fetchAttachmentBlob(url);
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read the attachment."));
    reader.readAsDataURL(blob);
  });
}

async function fetchAttachmentBlob(url: string): Promise<Blob> {
  const token = await SDK.getAccessToken();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error(`Image fetch failed: ${response.status}`);
  }
  return await response.blob();
}
