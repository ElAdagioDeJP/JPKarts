// Generates build/icon.png (256×256): the JP Kart tennis ball on the night-purple background. No image deps.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const S = 256, px = new Uint8Array(S * S * 4);
const set = (x: number, y: number, [r, g, b]: number[]) => { const i = (y * S + x) * 4; px[i] = r!; px[i + 1] = g!; px[i + 2] = b!; px[i + 3] = 255; };
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  // pixel art at 16 px per "pixel" for a chunky look
  const gx = (x / 16) | 0, gy = (y / 16) | 0, cx = gx - 7.5, cy = gy - 7.5, d = Math.hypot(cx, cy);
  let c = [27, 23, 64];
  if (d < 6.6) {
    const l = -(cx * 0.62 + cy * 0.78) / 6.6, seam = Math.abs(cx - 1.5 * Math.cos(cy * 0.35)) < 0.8;
    c = seam ? [255, 255, 255] : l > 0.35 ? [232, 255, 120] : l > -0.2 ? [216, 240, 58] : [160, 180, 40];
  } else if (d < 7.4) c = [26, 16, 38];
  set(x, y, c);
}
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b: Uint8Array) => { let c = -1; for (const v of b) c = crcT[(c ^ v) & 255]! ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
};
const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
dv.setUint32(0, S); dv.setUint32(4, S); ihdr[8] = 8; ihdr[9] = 6;
const raw = new Uint8Array(S * (S * 4 + 1));
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; raw.set(px.subarray(y * S * 4, (y + 1) * S * 4), y * (S * 4 + 1) + 1); }
const png = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
const dir = join(import.meta.dir, '..', 'build');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'icon.png'), Buffer.concat(png));
console.log('build/icon.png');
