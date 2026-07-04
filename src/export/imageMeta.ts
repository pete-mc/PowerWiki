import type { ExportImage } from "./types";

type ExportImageType = ExportImage["type"];

/** Maps a file path/URL extension to a docx-supported raster image type. */
export function imageTypeFromPath(path: string): ExportImageType | null {
  const match = /\.(png|jpe?g|gif|bmp)(?:[?#]|$)/i.exec(path);
  if (!match) {
    return null; // e.g. .svg — not embeddable via ImageRun, caller skips it
  }
  const ext = match[1].toLowerCase();
  return ext === "jpeg" || ext === "jpg" ? "jpg" : (ext as ExportImageType);
}

/** Wraps raster bytes as an ExportImage, measuring natural dimensions. */
export async function toExportImage(data: Uint8Array, path: string): Promise<ExportImage | null> {
  const type = imageTypeFromPath(path);
  if (!type) {
    return null;
  }

  const mime = type === "jpg" ? "image/jpeg" : `image/${type}`;
  // ArrayBufferView copy to satisfy Blob's typing across TS lib versions.
  const blob = new Blob([data.slice()], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth || 600, height: image.naturalHeight || 400 });
      image.onerror = () => reject(new Error("image decode failed"));
      image.src = url;
    });
    return { data, width, height, type };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
