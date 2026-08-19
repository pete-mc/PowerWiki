// Builds vscode/icon.png from media/logo_new.png.
//
//   node tools/media/make-vscode-icon.mjs
//
// Why this exists rather than a hand-made file checked in: the brand logo is a
// near-black glyph (`#212121`) on a transparent background. That is right on
// the white Marketplace page and invisible in the VS Code Extensions view,
// which is dark for most people — the icon reads as an empty slot. The fix is
// an icon that carries its own background instead of borrowing the theme's, and
// a generated one stays correct when the logo changes.
//
// The glyph is single-colour, so its alpha channel is the shape: mask the logo,
// paint it white, and composite over a solid Azure DevOps blue.
//
// PNG encoding and decoding are done here directly. Adding an image library to
// build one 512px icon would be a dependency in every install of this project
// forever, and the format's baseline (8-bit RGBA, no interlacing) is small.

import { deflateSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodePng } from "./png.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE = path.join(REPO_ROOT, "media", "logo_new.png");
const TARGET = path.join(REPO_ROOT, "vscode", "icon.png");

/** Azure DevOps accent, the same value `--pw-accent` falls back to. */
const BACKGROUND = [0x00, 0x78, 0xd4];
const GLYPH = [0xff, 0xff, 0xff];
const SIZE = 512;
/** Fraction of the canvas the glyph occupies, leaving a margin so it can breathe. */
const GLYPH_SCALE = 0.62;

function main() {
  const source = decodePng(fs.readFileSync(SOURCE));
  const bounds = alphaBounds(source);
  if (!bounds) {
    throw new Error(`${SOURCE} is fully transparent; nothing to build an icon from.`);
  }

  const icon = render(source, bounds);
  fs.writeFileSync(TARGET, encodePng(icon, SIZE, SIZE));
  console.log(
    `Wrote ${path.relative(REPO_ROOT, TARGET)} (${SIZE}x${SIZE}, ` +
      `glyph ${bounds.width}x${bounds.height} from ${path.relative(REPO_ROOT, SOURCE)})`
  );
}

/** Composites the masked glyph, centred and scaled, over the solid background. */
function render(image, bounds) {
  const out = Buffer.alloc(SIZE * SIZE * 4);

  // Preserve the glyph's aspect ratio: squashing a logo to fill a square is the
  // kind of thing nobody notices in review and everybody notices in the list.
  const longest = Math.max(bounds.width, bounds.height);
  const scale = (SIZE * GLYPH_SCALE) / longest;
  const drawWidth = bounds.width * scale;
  const drawHeight = bounds.height * scale;
  const offsetX = (SIZE - drawWidth) / 2;
  const offsetY = (SIZE - drawHeight) / 2;

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      // Back-project the destination pixel into the source's cropped glyph box.
      const sourceX = bounds.left + ((x + 0.5 - offsetX) / scale - 0.5);
      const sourceY = bounds.top + ((y + 0.5 - offsetY) / scale - 0.5);
      const alpha = sampleAlpha(image, sourceX, sourceY) / 255;

      const index = (y * SIZE + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        out[index + channel] = Math.round(
          GLYPH[channel] * alpha + BACKGROUND[channel] * (1 - alpha)
        );
      }
      // Fully opaque throughout: the whole point is not to depend on whatever
      // is behind it.
      out[index + 3] = 0xff;
    }
  }

  return out;
}

/** Bilinear sample of the alpha channel, clamped at the edges. */
function sampleAlpha(image, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;

  const a00 = alphaAt(image, x0, y0);
  const a10 = alphaAt(image, x0 + 1, y0);
  const a01 = alphaAt(image, x0, y0 + 1);
  const a11 = alphaAt(image, x0 + 1, y0 + 1);

  return (
    a00 * (1 - fx) * (1 - fy) + a10 * fx * (1 - fy) + a01 * (1 - fx) * fy + a11 * fx * fy
  );
}

function alphaAt(image, x, y) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    return 0;
  }
  return image.data[(y * image.width + x) * 4 + 3];
}

/** Tightest box containing any non-transparent pixel. */
function alphaBounds(image) {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }

  if (right < 0) {
    return undefined;
  }

  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

// --- PNG ------------------------------------------------------------------

function encodePng(rgba, width, height) {
  const stride = width * 4;
  // Filter 0 (None) on every row: the image is a flat background plus one
  // glyph, so it compresses well regardless, and it keeps this readable.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Last: everything above, including the CRC table, must be initialised first.
main();
