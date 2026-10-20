// Online end-of-race check: once the server goes back to the room every client must leave the results (they used to
// hang on "Esperando..." and drop out of the room ~40 s later). Cup (default): the cup podium shows and Enter goes
// back to the lobby. --mode=free|elimination|battle: straight back to the lobby.
// Usage: bun tools/cupfinal-check.mjs [--mode=cup|free|elimination|battle] [outDir]   (needs `bun run dev` on :5173)
import { chromium } from 'playwright';
import fs from 'node:fs';
import { startOnlineServer } from '../packages/server/src/online.ts';
import { ARENA_INDICES } from '../packages/core/src/index.ts';

const mode = process.argv.find((a) => a.startsWith('--mode='))?.slice(7) ?? 'cup';
const out = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'shots-cupfinal';
fs.mkdirSync(out, { recursive: true });
const PORT = 7792, on = startOnlineServer(PORT, () => {});
let browser;
try { browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-unsafe-webgpu'] }); } catch { browser = await chromium.launch({ headless: true }); }
const errors = [];
let code = '';
async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ' console: ' + m.text()); });
  await page.goto('http://localhost:5173/');
  await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000, polling: 500 });
  await page.evaluate(([n, a, c]) => { const g = window.__jpkart; g.state = 'menu'; g.lanName = n; g.profile = { ...g.profile, id: 'pid-' + n + '-0000001', name: n, tutorialDone: true }; g.connectLan(a, n, c ? { room: c } : { create: true }); }, [name, 'localhost:' + PORT, code]);
  await page.waitForFunction(() => window.__jpkart.net?.status === 'lobby' && window.__jpkart.net.id > 0, null, { timeout: 15000 });
  if (!code) code = await page.evaluate(() => window.__jpkart.net.room);
  return page;
}
// polls from node: page-side waitForFunction uses rAF/timers that background tabs throttle
const until = async (p, fn, ms = 30000, arg) => { const t = Date.now(); while (!(await p.evaluate(fn, arg))) { if (Date.now() - t > ms) throw new Error('timeout: ' + fn); await new Promise((r) => setTimeout(r, 300)); } };
const state = (p) => p.evaluate(() => window.__jpkart.state);
const host = await player('Ana'), guest = await player('Beto');
await guest.keyboard.press('ArrowRight'); await guest.waitForTimeout(200); await guest.keyboard.press('KeyR'); await guest.waitForTimeout(300);
if (mode !== 'cup') {
  await host.evaluate(([m, ti]) => { const n = window.__jpkart.net; n.send({ t: 'settings', s: { ...n.settings, mode: m, ...(m === 'battle' ? { trackIndex: ti } : {}) } }); }, [mode, ARENA_INDICES[0]]);
  await host.waitForTimeout(500);
}
await host.keyboard.press('Enter');
for (const p of [host, guest]) await until(p, () => window.__jpkart.state === 'race', 60000);
const room = [...on.rooms.values()][0];
if (mode === 'cup') room.cupRace = 3; // this race is the cup's last one
await host.waitForTimeout(5000);
room.world.finishDelay = 0.01; // the mode's end condition, whatever the mode: the race ends next tick
for (const p of [host, guest]) await until(p, () => window.__jpkart.state === 'results', 60000);
await host.keyboard.press('Enter'); // the host skips the wait: the server goes back to the room
const want = mode === 'cup' ? 'final' : 'lobby';
for (const p of [host, guest]) await until(p, (w) => window.__jpkart.state === w, 20000, want);
await host.waitForTimeout(1500);
await guest.screenshot({ path: `${out}/${mode}-end-guest.png` });
// nothing pulls the player out of the room afterwards (the reconnect timeout used to)
await guest.waitForTimeout(45000);
const guestStill = await state(guest), guestNet = await guest.evaluate(() => window.__jpkart.net?.status);
if (mode === 'cup') { await guest.keyboard.press('Enter'); await until(guest, () => window.__jpkart.state === 'lobby', 5000); }
console.log(JSON.stringify({ mode, guestAfter45s: guestStill, guestNet, guestNow: await state(guest), errors: errors.slice(0, 5) }));
const ok = guestStill === want && guestNet === 'lobby' && !errors.length;
await browser.close(); on.close();
console.log(ok ? 'OK' : 'FALLÓ');
process.exit(ok ? 0 : 1);
