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
const BG = [27, 23, 64], FG = [216, 240, 58];
const disc = (rFrac) => (x, y, s) => {
  const dx = (x - s / 2) / s, dy = (y - s / 2) / s;
  return Math.hypot(dx, dy) <= rFrac ? FG : BG;
};
writeFileSync(resolve(root, 'icon-192.png'), png(192, disc(0.31)));
writeFileSync(resolve(root, 'icon-512.png'), png(512, disc(0.31)));
writeFileSync(resolve(root, 'maskable-512.png'), png(512, disc(0.25)));
console.log('iconos PWA generados en', root);
