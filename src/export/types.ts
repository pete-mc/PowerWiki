import type { Paragraph, Table } from "docx";

export type DocxBlock = Paragraph | Table;

/** Numbering instance reference used for ordered lists in exported documents. */
export const ORDERED_NUMBERING_REFERENCE = "pw-ordered";

export interface ExportImage {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly type: "png" | "jpg" | "gif" | "bmp";
}

/** Resolves a Markdown/HTML image src (relative to pagePath) to bytes, or null. */
export type LoadExportImage = (src: string, pagePath: string) => Promise<ExportImage | null>;
