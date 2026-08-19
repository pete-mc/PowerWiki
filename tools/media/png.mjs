// Just enough PNG to read and write the icon this repository generates.
//
// Shared by `make-vscode-icon.mjs`, which writes the icon, and by
// `tools/release/assert-vscode-manifest.mjs`, which refuses to publish one that
// would be invisible. One decoder, so the check and the thing it checks cannot
// disagree.

import { deflateSync, inflateSync } from "node:zlib";

export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new Error("Not a PNG.");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colorType, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
      // Only what the brand asset actually is. A silent wrong answer here would
      // produce a subtly corrupt icon rather than an error.
      if (depth !== 8 || colorType !== 6 || interlace !== 0) {
        throw new Error(
          `Unsupported PNG (depth ${depth}, colorType ${colorType}, interlace ${interlace}); ` +
            "expected 8-bit RGBA, non-interlaced."
        );
      }
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }

    offset += 12 + length;
  }

  return { width, height, data: unfilter(inflateSync(Buffer.concat(idat)), width, height) };
}

/** Reverses the per-scanline filters PNG applies before compression. */
function unfilter(raw, width, height) {
  const stride = width * 4;
  const out = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));

    for (let x = 0; x < stride; x += 1) {
      const a = x >= 4 ? out[y * stride + x - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      let value = line[x];

      switch (filter) {
        case 0:
          break;
        case 1:
          value += a;
          break;
        case 2:
          value += b;
          break;
        case 3:
          value += (a + b) >> 1;
          break;
        case 4:
          value += paeth(a, b, c);
          break;
        default:
          throw new Error(`Unknown PNG filter ${filter} on row ${y}.`);
      }

      out[y * stride + x] = value & 0xff;
    }
  }

  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}
