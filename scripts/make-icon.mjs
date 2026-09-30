/**
 * Generates `images/icon.png` (128x128) without any dependency.
 *
 * A Marketplace icon must be a PNG, and pulling a whole image library in for one
 * static asset would contradict the "no unnecessary dependency" rule. So we
 * rasterize a shield with a keyhole by hand and encode it with `zlib`, which
 * ships with Node.
 *
 * Run with: node scripts/make-icon.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 128;
const SCALE = 4; // supersampling factor for antialiasing

const BACKGROUND = [22, 27, 34, 255];
const SHIELD = [88, 166, 255, 255];
const SHIELD_DARK = [56, 118, 199, 255];
const KEYHOLE = [13, 17, 23, 255];

/** Signed distance style test: is (x, y) inside the shield outline? */
function insideShield(x, y) {
  // Normalized coordinates, origin at the centre, y downwards.
  const nx = (x - SIZE / 2) / (SIZE * 0.36);
  const ny = (y - SIZE / 2) / (SIZE * 0.42);

  if (ny < -1 || ny > 1) {
    return false;
  }
  // Top half: a rounded rectangle. Bottom half: tapering to a point.
  const halfWidth = ny < -0.2 ? 1 : 1 - Math.pow((ny + 0.2) / 1.2, 2) * 0.98;
  if (Math.abs(nx) > halfWidth) {
    return false;
  }
  // Round the top corners.
  if (ny < -0.75) {
    const cornerX = (Math.abs(nx) - 0.72) / 0.28;
    const cornerY = (-ny - 0.75) / 0.25;
    if (cornerX > 0 && cornerY > 0 && cornerX * cornerX + cornerY * cornerY > 1) {
      return false;
    }
  }
  return true;
}

function insideKeyhole(x, y) {
  const cx = SIZE / 2;
  const cy = SIZE * 0.44;
  const dx = x - cx;
  const dy = y - cy;
  if (dx * dx + dy * dy <= 13 * 13) {
    return true;
  }
  // Stem below the circle.
  return Math.abs(dx) <= 5.5 && y >= cy && y <= cy + 26;
}

function blend(target, index, color, alpha) {
  for (let channel = 0; channel < 3; channel += 1) {
    target[index + channel] = Math.round(
      target[index + channel] * (1 - alpha) + color[channel] * alpha,
    );
  }
  target[index + 3] = 255;
}

function render() {
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = BACKGROUND[0];
    pixels[i + 1] = BACKGROUND[1];
    pixels[i + 2] = BACKGROUND[2];
    pixels[i + 3] = BACKGROUND[3];
  }

  const samples = SCALE * SCALE;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let shieldHits = 0;
      let keyholeHits = 0;
      for (let sy = 0; sy < SCALE; sy += 1) {
        for (let sx = 0; sx < SCALE; sx += 1) {
          const px = x + (sx + 0.5) / SCALE;
          const py = y + (sy + 0.5) / SCALE;
          if (insideShield(px, py)) {
            shieldHits += 1;
            if (insideKeyhole(px, py)) {
              keyholeHits += 1;
            }
          }
        }
      }
      if (shieldHits === 0) {
        continue;
      }
      const index = (y * SIZE + x) * 4;
      // Vertical gradient so the shield does not look flat.
      const t = y / SIZE;
      const color = [
        Math.round(SHIELD[0] * (1 - t) + SHIELD_DARK[0] * t),
        Math.round(SHIELD[1] * (1 - t) + SHIELD_DARK[1] * t),
        Math.round(SHIELD[2] * (1 - t) + SHIELD_DARK[2] * t),
      ];
      blend(pixels, index, color, shieldHits / samples);
      if (keyholeHits > 0) {
        blend(pixels, index, KEYHOLE, keyholeHits / samples);
      }
    }
  }
  return pixels;
}

/* ------------------------------------------------------------ PNG encoding */

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
  let crc = -1;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * (SIZE * 4 + 1)] = 0; // filter type: none
    Buffer.from(pixels.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'images', 'icon.png');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, encodePng(render()));
process.stdout.write(`wrote ${target}\n`);
