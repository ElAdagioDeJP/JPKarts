// Generates the JP Kart icons: a pixel-art CPU chip on the night-purple background. No image deps.
//   apps/desktop/build/icon.{png,ico} (256). PWA icons: tools/gen-mobile-icons.mjs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const BG = [27, 23, 64], EDGE = [26, 16, 38], BODY = [38, 48, 92], DIE = [93, 230, 200], PIN = [255, 213, 74];
/** 16×16 pixel-art cell colour; the chip sits in cells 2..13 (inside the maskable safe zone). */
function cell(gx: number, gy: number): number[] {
  const inBody = gx >= 4 && gx <= 11 && gy >= 4 && gy <= 11;
  if (inBody) {
    if (gx === 4 || gx === 11 || gy === 4 || gy === 11) return EDGE;
    return gx >= 6 && gx <= 9 && gy >= 6 && gy <= 9 ? DIE : BODY;
  }
  const pinAt = (v: number) => v === 5 || v === 7 || v === 9; // pins at 5, 7, 9
  if (pinAt(gx) && (gy === 2 || gy === 3 || gy === 12 || gy === 13)) return PIN;
  if (pinAt(gy) && (gx === 2 || gx === 3 || gx === 12 || gx === 13)) return PIN;
  return BG;
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
function png(S: number): Buffer {
  const raw = new Uint8Array(S * (S * 4 + 1));
  for (let y = 0; y < S; y++) {
    const row = y * (S * 4 + 1);
    for (let x = 0; x < S; x++) {
      const [r, g, b] = cell(Math.floor(x * 16 / S), Math.floor(y * 16 / S));
      raw.set([r!, g!, b!, 255], row + 1 + x * 4);
    }
  }
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, S); dv.setUint32(4, S); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]);
}

const root = join(import.meta.dir, '..', '..', '..');
const dir = join(root, 'apps', 'desktop', 'build');
mkdirSync(dir, { recursive: true });
const pngBytes = png(256);
writeFileSync(join(dir, 'icon.png'), pngBytes);
// icon.ico: ICO container with the PNG inside (valid on Vista+; lets electron-builder skip its png->ico converter).
const ico = Buffer.alloc(6 + 16 + pngBytes.length);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico[6] = 0; ico[7] = 0; ico[8] = 0; ico[9] = 0; ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(pngBytes.length, 14); ico.writeUInt32LE(6 + 16, 18);
pngBytes.copy(ico, 6 + 16);
writeFileSync(join(dir, 'icon.ico'), ico);
console.log('build/icon.png + build/icon.ico');
