// End-to-end LAN check: two browser pages join `bun run server`, the host starts, both race.
// Usage: node tools/lan-check.mjs [outDir] [--online=host:port]   (needs `bun run dev` and the server running)
// --online: the online server instead (the host creates a room through the Online screen, the guest types the code).
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots';
const onlineArg = process.argv.find((a) => a.startsWith('--online='));
const online = onlineArg ? onlineArg.split('=')[1] : null;
let roomCode = '';
fs.mkdirSync(out, { recursive: true });
let browser;
try { browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-unsafe-webgpu'] }); } catch { browser = await chromium.launch({ headless: true }); }
const errors = [];
async function player(name) {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  await page.goto('http://localhost:5173/');
  await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 });
  if (!online) await page.evaluate((n) => { const g = window.__jpkart; g.state = 'menu'; g.connectLan('localhost', n); }, name);
  else {
    // drive the Online screen with the keyboard like a player
    await page.evaluate((n) => { const g = window.__jpkart; g.state = 'menu'; g.menuSel = 5; g.lanName = n; g.onlineAddr = ''; g.onlineCode = ''; }, name);
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    await page.keyboard.type(online); await page.waitForTimeout(300);
    if (roomCode) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200); await page.keyboard.type(roomCode); await page.waitForTimeout(300); }
    await page.keyboard.press('Enter');
  }
  await page.waitForFunction(() => window.__jpkart.net?.status === 'lobby' && window.__jpkart.net.id > 0, null, { timeout: 15000 });
  if (online && !roomCode) roomCode = await page.evaluate(() => window.__jpkart.net.room);
  return page;
}
const host = await player('Ana');
const guest = await player('Beto');
const key = async (p, k) => { await p.keyboard.press(k); await p.waitForTimeout(150); };
await key(guest, 'ArrowRight'); // pick another character
await key(guest, 'KeyR'); // ready
await host.waitForTimeout(400);
await host.screenshot({ path: `${out}/lan-1-lobby.png` });
await key(host, 'Enter'); // start
await host.waitForFunction(() => window.__jpkart.state === 'race', null, { timeout: 60000 });
await guest.waitForFunction(() => window.__jpkart.state === 'race', null, { timeout: 60000 });
for (const p of [host, guest]) await p.keyboard.down('ArrowUp');
await host.waitForTimeout(9000);
await host.screenshot({ path: `${out}/lan-2-host.png` });
await guest.screenshot({ path: `${out}/lan-3-guest.png` });
const info = async (p) => p.evaluate(() => { const g = window.__jpkart, r = g.net.race; return { kart: r.kart, pending: r.pendingCount, serverTick: r.serverTick, tick: r.world.tick, prog: r.world.karts[r.kart].prog, humans: r.world.karts.filter((k) => k.ctrl !== 'ai').length, corrP95: [...r.corrections].sort((a, b) => a - b)[Math.floor(r.corrections.length * 0.95)] ?? 0 }; });
console.log(JSON.stringify({ room: roomCode || undefined, host: await info(host), guest: await info(guest), errors }));
await browser.close();
