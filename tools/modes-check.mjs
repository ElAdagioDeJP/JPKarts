// Phase 9 browser check: menu, locked cups, time trial (record + ghost saved, ghost shown on the next run),
// end-of-race replay and elimination HUD. Teleports the local kart near the line to finish quickly (debug only).
// Usage: node tools/modes-check.mjs [outDir]   (needs `bun run dev`)
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] ?? 'shots-modes';
fs.mkdirSync(out, { recursive: true });
const launchOpts = { headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=d3d11', '--ignore-gpu-blocklist'] };
let browser;
try { browser = await chromium.launch({ ...launchOpts, channel: 'msedge' }); }
catch { browser = await chromium.launch(launchOpts); }
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 });
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('jpkart.ghost') || k.startsWith('jpkart.progress')) localStorage.removeItem(k); window.__jpkart.progress = { version: 2, cups: {}, records: {}, races: 0 }; });
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(110); } };
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
/** Put the local kart a few samples before the finish line of its last lap. */
const nearFinish = () => page.evaluate(() => {
  const g = window.__jpkart, w = g.world, tr = w.track, k = g.local, i = tr.N - 40;
  k.x = tr.x[i]; k.y = tr.y[i]; k.a = k.va = tr.ang[i]; k.idx = i; k.prog = (w.cfg.laps - 1) * tr.N + i; k.lastLap = w.cfg.laps; k.speed = 120;
});
const result = {};

await key('Enter'); // title → menu
await shot('01-menu');
// Torneo: locked cups and the class line
await key('Enter'); await key('Enter');
await shot('02-cups');
await key('Escape'); await key('Escape');
// Contrarreloj
await key('ArrowDown', 2); await key('Enter'); await key('Enter');
await page.evaluate(() => { window.__jpkart.trackSel = 0; });
await key('Enter');
await page.waitForFunction(() => window.__jpkart.world?.phase === 'race', null, { timeout: 60000 });
result.tt = await page.evaluate(() => { const k = window.__jpkart.local; return { coins: k.coins, item: k.item, itemN: k.itemN, karts: window.__jpkart.world.karts.length }; });
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(1500);
await nearFinish();
await page.waitForFunction(() => window.__jpkart.state === 'results', null, { timeout: 30000 });
await page.keyboard.up('ArrowUp');
await page.waitForTimeout(400);
await shot('03-tt-results');
result.saved = await page.evaluate(() => ({ notes: window.__jpkart.resultNotes, ghost: Object.keys(localStorage).filter((k) => k.startsWith('jpkart.ghost')), progress: JSON.parse(localStorage.getItem('jpkart.progress') ?? 'null') }));
// replay with the highlight camera
await key('KeyR');
await page.waitForTimeout(1500);
result.replayState = await page.evaluate(() => window.__jpkart.state);
await shot('04-replay');
await key('Enter');
// next run: the ghost appears
await key('Enter');
await page.waitForFunction(() => window.__jpkart.world?.phase === 'race' && !!window.__jpkart.ghost, null, { timeout: 60000 });
await page.waitForTimeout(800);
await shot('05-tt-ghost');
result.ghostRun = await page.evaluate(() => !!window.__jpkart.ghost);
await key('Escape'); await key('Escape');
await page.waitForTimeout(300);
// Eliminación
await page.evaluate(() => { const g = window.__jpkart; g.state = 'menu'; g.menuSel = 3; });
await key('Enter'); await key('Enter'); await key('Enter');
await page.waitForFunction(() => window.__jpkart.world?.phase === 'race', null, { timeout: 60000 });
result.elim = await page.evaluate(() => ({ laps: window.__jpkart.world.cfg.laps, mode: window.__jpkart.world.cfg.mode }));
await page.waitForTimeout(800);
await shot('06-elimination');
// Batalla: Globos, then Captura (M on the arena screen)
for (const [n, toggle] of [['07-battle', false], ['08-capture', true]]) {
  await key('Escape'); await key('Escape');
  await page.evaluate(() => { const g = window.__jpkart; g.paused = false; g.world = null; g.state = 'menu'; g.menuSel = 4; });
  await key('Enter'); await key('Enter');
  await page.waitForTimeout(300);
  if (toggle) await key('KeyC');
  await shot(n + '-arenas');
  await key('Enter');
  await page.waitForFunction(() => window.__jpkart.world?.phase === 'race', null, { timeout: 60000 });
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(6000);
  await page.keyboard.up('ArrowUp');
  await shot(n);
  result[n] = await page.evaluate(() => { const w = window.__jpkart.world; return { mode: w.cfg.mode, laps: w.cfg.laps, balloons: w.karts.map((k) => k.balloons), flag: w.ents.filter((e) => e.kind === 'flag').length }; });
}
result.errors = errors;
fs.writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
await browser.close();
