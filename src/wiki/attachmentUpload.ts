/**
 * Pure helpers shared by the editors and WikiBrowser for uploading files to the
 * wiki's `.attachments` folder. The actual REST call lives in WikiBrowser (it
 * owns the wiki client); these helpers cover encoding, naming, extracting files
 * from paste/drop events, and building the Markdown reference to insert.
 */

/** The outcome of uploading one file, used to build the Markdown reference. */
export interface AttachmentUploadResult {
  readonly name: string;
  /** Wiki-relative path, e.g. "/.attachments/diagram-lk9f2.png". */
  readonly path: string;
  readonly isImage: boolean;
}

/** Uploads a single file and resolves with its stored name, path, and kind. */
export type UploadAttachment = (file: File) => Promise<AttachmentUploadResult>;

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

/** True when a stored attachment path looks like an image (by extension). */
export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(path);
}

/** Base64-encodes the file's bytes for the wiki attachments API request body. */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/**
 * Builds a collision-resistant, filesystem-safe attachment name. Pasted images
 * often arrive without a usable name, so a type-based fallback is used.
 */
export function buildAttachmentName(file: File): string {
  const original = file.name && file.name.toLowerCase() !== "blob" ? file.name : `image${extensionForType(file.type)}`;
  const dot = original.lastIndexOf(".");
  const base = sanitizeSegment(dot > 0 ? original.slice(0, dot) : original) || "attachment";
  const ext = sanitizeSegment(dot > 0 ? original.slice(dot + 1) : extensionForType(file.type).replace(/^\./, ""));
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return ext ? `${base}-${unique}.${ext}` : `${base}-${unique}`;
}

/** Markdown to insert for an uploaded file: an image embed or a plain link. */
export function attachmentMarkdown(result: AttachmentUploadResult): string {
  const label = result.name.replace(/[[\]]/g, "");
  const url = result.path.replace(/ /g, "%20");
  return result.isImage ? `![${label}](${url})` : `[${label}](${url})`;
}

/** Extracts File objects from a clipboard or drag-and-drop transfer. */
export function filesFromDataTransfer(data: DataTransfer | null): File[] {
  if (!data) {
    return [];
  }

  const files: File[] = [];
  if (data.files && data.files.length > 0) {
    files.push(...Array.from(data.files));
  } else if (data.items && data.items.length > 0) {
    for (const item of Array.from(data.items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }
  }
  return files;
}

/** True when a drag event is carrying files (so the editor should accept a drop). */
export function dragHasFiles(data: DataTransfer | null): boolean {
  return Boolean(data && Array.from(data.types).includes("Files"));
}

function sanitizeSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "");
}

function extensionForType(type: string): string {
  switch (type) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "image/svg+xml":
      return ".svg";
    case "image/bmp":
      return ".bmp";
    default:
      return "";
  }
}
