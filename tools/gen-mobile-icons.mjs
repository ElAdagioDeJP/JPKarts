// Genera los iconos PWA (M0): 192/512 any + 512 maskable. PNG RGB puros, sin dependencias.
// Uso: bun tools/gen-mobile-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/client/public/icons');
mkdirSync(root, { recursive: true });

const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
}
function png(size, draw) {
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 3)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = draw(x, y, size);
      const o = y * (1 + size * 3) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
// CPU chip, 16x16 pixel-art grid (same drawing as apps/desktop/scripts/icon.ts). `pad` shrinks it inside the maskable safe zone.
const BG = [27, 23, 64], EDGE = [26, 16, 38], BODY = [38, 48, 92], DIE = [93, 230, 200], PIN = [255, 213, 74];
const pinAt = (v) => v === 5 || v === 7 || v === 9;
function cell(gx, gy) {
  if (gx >= 4 && gx <= 11 && gy >= 4 && gy <= 11) {
    if (gx === 4 || gx === 11 || gy === 4 || gy === 11) return EDGE;
    return gx >= 6 && gx <= 9 && gy >= 6 && gy <= 9 ? DIE : BODY;
  }
  if (pinAt(gx) && (gy === 2 || gy === 3 || gy === 12 || gy === 13)) return PIN;
  if (pinAt(gy) && (gx === 2 || gx === 3 || gx === 12 || gx === 13)) return PIN;
  return BG;
}
const chip = (scale) => (x, y, s) => {
  const u = (v) => Math.floor(((v / s - 0.5) / scale + 0.5) * 16);
  const gx = u(x), gy = u(y);
  return gx < 0 || gy < 0 || gx > 15 || gy > 15 ? BG : cell(gx, gy);
};
writeFileSync(resolve(root, 'icon-192.png'), png(192, chip(1)));
writeFileSync(resolve(root, 'icon-512.png'), png(512, chip(1)));
writeFileSync(resolve(root, 'maskable-512.png'), png(512, chip(0.8)));
console.log('iconos PWA generados en', root);
