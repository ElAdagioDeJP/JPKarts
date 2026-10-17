// Online flow check: two browser pages play a cup race, the first finishes (spectator + 30 s clock),
// the race ends, standings count down and the next race starts by itself with no errors.
// Usage: bun tools/nextrace-check.mjs [outDir]   (needs `bun run dev` on :5173)
import { chromium } from 'playwright';
import fs from 'node:fs';
import { startOnlineServer } from '../packages/server/src/online.ts';

const out = process.argv[2] ?? 'shots';
fs.mkdirSync(out, { recursive: true });
const PORT = 7790, on = startOnlineServer(PORT, () => {});
let browser;
try { browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-unsafe-webgpu'] }); } catch { browser = await chromium.launch({ headless: true }); }
const errors = [];
let code = '';
async function player(name) {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ' console: ' + m.text()); });
  await page.goto('http://localhost:5173/');
  await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000, polling: 500 });
  await page.evaluate(([n, a, c]) => { const g = window.__jpkart; g.state = 'menu'; g.lanName = n; g.profile = { ...g.profile, id: 'pid-' + n + '-0000001', name: n, tutorialDone: true }; g.connectLan(a, n, c ? { room: c } : { create: true }); }, [name, 'localhost:' + PORT, code]);
  await page.waitForFunction(() => window.__jpkart.net?.status === 'lobby' && window.__jpkart.net.id > 0, null, { timeout: 15000 });
  if (!code) code = await page.evaluate(() => window.__jpkart.net.room);
  return page;
}
// first run: welcome + tutorial + name, saved for good (a fresh browser context has no profile)
{
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('welcome: ' + e.message));
  await page.goto('http://localhost:5173/');
  await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000, polling: 500 });
  console.log('first run state', await page.evaluate(() => window.__jpkart.state));
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(150); }
  await page.screenshot({ path: `${out}/welcome-name.png` });
  await page.keyboard.type('Juan'); await page.waitForTimeout(200);
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  const saved = await page.evaluate(() => ({ state: window.__jpkart.state, profile: JSON.parse(localStorage.getItem('jpkart.profile') ?? 'null') }));
  console.log('welcome saved', JSON.stringify(saved));
  await page.reload(); await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000, polling: 500 });
  console.log('second run state', await page.evaluate(() => window.__jpkart.state), await page.evaluate(() => window.__jpkart.profile.name));
  await ctx.close();
}
// polls from node: page-side waitForFunction uses rAF/timers that background tabs throttle
const until = async (p, fn, ms = 30000) => { const t = Date.now(); while (!(await p.evaluate(fn))) { if (Date.now() - t > ms) throw new Error('timeout: ' + fn); await new Promise((r) => setTimeout(r, 300)); } };
const host = await player('Ana'), guest = await player('Beto');
await guest.keyboard.press('ArrowRight'); await guest.waitForTimeout(200); await guest.keyboard.press('KeyR'); await guest.waitForTimeout(300);
await host.screenshot({ path: `${out}/next-1-lobby.png` });
await host.keyboard.press('Enter');
for (const p of [host, guest]) await until(p, () => window.__jpkart.state === 'race', 60000);
await host.waitForTimeout(6000);
const room = [...on.rooms.values()][0];
const humans = () => room.world.karts.filter((k) => k.ctrl !== 'ai');
const info = (p) => p.evaluate(() => { const g = window.__jpkart; return { state: g.state, track: g.curTrack, tick: g.net?.race?.world.tick, spec: g.specId, local: g.local?.id, finished: g.local?.finished }; });
// the host crosses the line first → spectator + clock
const h0 = room.world.karts.find((k) => k.ctrl === 'remote');
h0.finished = true; h0.time = 50;
await host.waitForTimeout(4000);
await host.screenshot({ path: `${out}/next-2-spectator.png` });
console.log('spectator', JSON.stringify(await info(host)), 'lastCall', room.world.lastCall);
// the guest finishes too → results → standings → next race by itself
if (!process.argv.includes('--stuck-guest')) for (const k of humans()) { k.finished = true; k.time ??= 55; } // --stuck-guest: the guest never finishes, the 30 s clock ends the race
await until(host, () => window.__jpkart.state === 'results', 60000);
await until(guest, () => window.__jpkart.state === 'results', 20000);
await host.waitForTimeout(1500);
await host.screenshot({ path: `${out}/next-3-results.png` });
console.log('results', JSON.stringify(await info(host)), 'cupRace', room.cupRace);
const t0 = Date.now();
await until(host, () => window.__jpkart.state === 'race', 30000);
await until(guest, () => window.__jpkart.state === 'race', 30000);
console.log('next race after', ((Date.now() - t0) / 1000).toFixed(1), 's', 'cupRace', room.cupRace);
await host.waitForTimeout(6000);
await host.screenshot({ path: `${out}/next-4-race2.png` });
const a = await info(host); await host.waitForTimeout(1000); const b = await info(host);
console.log('race2', JSON.stringify(a), JSON.stringify(b), 'ticking', b.tick > a.tick);
// the guest's connection dies mid-race: the game shows it, reconnects and gets its kart back
const gk = (await guest.evaluate(() => window.__jpkart.net.race.kart));
await guest.evaluate(() => window.__jpkart.net.ws.close());
await host.waitForTimeout(200);
console.log('guest kart right after the drop:', room.world.karts[gk].ctrl, '(AI until it reconnects, ~instant on localhost)');
await until(guest, () => window.__jpkart.net.status === 'race' && !window.__jpkart.recon && window.__jpkart.net.go, 20000);
const g1 = await info(guest); await guest.waitForTimeout(1000); const g2 = await info(guest);
console.log('guest back', JSON.stringify(g2), 'ctrl', room.world.karts[gk].ctrl, 'ticking', g2.tick > g1.tick);
await guest.screenshot({ path: `${out}/next-5-guest-back.png` });
console.log(JSON.stringify({ errors }));
const ok = !errors.length && b.tick > a.tick && g2.tick > g1.tick && room.world.karts[gk].ctrl === 'remote';
await browser.close(); on.close();
console.log(ok ? 'OK' : 'FALLÓ');
process.exit(ok ? 0 : 1);
