// Phase 8 visual check: for each authored track, start a free race, put the local kart right before the track's
// gimmick (or the first coin line) and take screenshots. Visual only: the kart is moved like a debug teleport.
// Usage: node tools/hazard-shots.mjs [outDir] [slot,slot,...] [--webgl]
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots-hazards';
const slots = (process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15').split(',').map(Number);
const webgl = process.argv.includes('--webgl');
fs.mkdirSync(out, { recursive: true });

const launchOpts = { headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=d3d11', '--ignore-gpu-blocklist'] };
let browser;
try { browser = await chromium.launch({ ...launchOpts, channel: 'msedge' }); }
catch { browser = await chromium.launch(launchOpts); }
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
await page.goto('http://localhost:5173/' + (webgl ? '?webgl' : ''));
await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 });
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(100); } };

await key('Enter'); await key('ArrowDown'); await key('Enter'); await key('Enter'); // title → menu → free race → select → track
for (const slot of slots) {
  await page.evaluate((s) => { const g = window.__jpkart; g.state = 'track'; g.classic = false; g.trackSel = s; }, slot);
  await key('Enter');
  await page.waitForFunction(() => window.__jpkart.state === 'race' && window.__jpkart.world?.phase === 'race', null, { timeout: 60000 });
  // the gimmick: first hazard of the track (or the first coin line); lap 2 so weather/gates are on
  const info = await page.evaluate(() => {
    const g = window.__jpkart, w = g.world, tr = w.track, a = tr.authored, k = g.local;
    const h = a.hazards[0], at = h ? h.at : a.itemRows[0] + 0.045;
    const i = (Math.floor((at - 0.012) * tr.N) + tr.N) % tr.N;
    k.x = tr.x[i]; k.y = tr.y[i]; k.a = k.va = tr.ang[i]; k.idx = i; k.prog = i + tr.N; k.lastLap = 2; k.speed = 40;
    for (const o of w.karts) if (o !== k && o.ai) o.ai.speed = 0.6;
    return { name: tr.def.name, hazard: h ? h.kind : 'monedas', weather: a.weather?.kind ?? '', dayNight: !!a.dayNight };
  });
  for (let n = 0; n < 3; n++) {
    await page.waitForTimeout(n === 0 ? 700 : 1300);
    await page.screenshot({ path: `${out}/${String(slot).padStart(2, '0')}-${info.hazard}-${n}.png` });
  }
  console.log(slot, JSON.stringify(info));
  await key('Escape'); // pause
  await page.evaluate(() => { const g = window.__jpkart; g.paused = false; g.world = null; g.state = 'track'; });
}
fs.writeFileSync(`${out}/log.txt`, logs.join('\n'));
console.log(logs.slice(0, 20).join('\n'));
await browser.close();
