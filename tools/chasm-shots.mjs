// V3-5 visual check of the chasms: for each track with one, put the local kart before the glide ramp, drive over it and take
// screenshots (approach, take-off, over the canyon, landing). Visual only: the kart is moved like a debug teleport.
// Usage: node tools/chasm-shots.mjs [outDir] [id,id,...] [--webgl]
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots-chasms';
const ids = (process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'volcan-rugiente,crater-ardiente,pico-nevado').split(',');
const webgl = process.argv.includes('--webgl');
fs.mkdirSync(out, { recursive: true });
const launchOpts = { headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=d3d11', '--ignore-gpu-blocklist'] };
let browser;
try { browser = await chromium.launch({ ...launchOpts, channel: 'msedge' }); } catch { browser = await chromium.launch(launchOpts); }
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/WebGPU|Destroyed|Shadow/.test(m.text())) logs.push(`[error] ${m.text()}`); });
await page.addInitScript(() => localStorage.setItem('jpkart.profile', JSON.stringify({ version: 2, id: '0123456789abcdef', name: 'Tester', tutorialDone: true, lastCh: -1, lastParts: { body: 'kernel', wheels: 'std', wing: 'wing' } })));
await page.goto('http://localhost:5173/' + (webgl ? '?webgl' : ''));
await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 });
const result = {};
for (const id of ids) {
  await page.evaluate((id) => { const g = window.__jpkart; g.mode = 'free'; g.players = 1; g.world = null; g.paused = false; g.initPickers(); g.startRace(g.trackIndexById(id)); }, id);
  await page.waitForFunction(() => window.__jpkart.state === 'race' && window.__jpkart.world?.phase === 'race', null, { timeout: 120000 });
  const info = await page.evaluate(() => {
    const g = window.__jpkart, w = g.world, tr = w.track, k = g.local, c = tr.chasms[0], r = tr.ramps.find((q) => q.kind === 'glide');
    const i = (r.i - 30 + tr.N) % tr.N;
    k.x = tr.x[i]; k.y = tr.y[i]; k.a = k.va = tr.ang[i]; k.idx = i; k.prog = i; k.speed = 20; k.z = tr.hc[i];
    for (const o of w.karts) if (o !== k && o.ai) { o.ai.speed = 0; o.x = tr.x[(i + 300) % tr.N]; o.y = tr.y[(i + 300) % tr.N]; o.idx = (i + 300) % tr.N; o.prog = o.idx; }
    return { name: tr.def.name, chasm: [c.i0, c.i1], ramp: r.i, N: tr.N };
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${id}-approach.png` });
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => window.__jpkart.local.glide, null, { timeout: 15000 }).catch(() => {});
  await page.keyboard.up('ArrowUp'); // gliding: the throttle would climb and bleed the speed
  const shots = [];
  for (let n = 0; n < 6; n++) {
    await page.waitForTimeout(n === 0 ? 120 : 520);
    await page.screenshot({ path: `${out}/${id}-${n}.png` });
    shots.push(await page.evaluate(() => { const k = window.__jpkart.local; return { idx: k.idx, air: k.air, glide: k.glide, z: Math.round(k.z), speed: Math.round(k.speed) }; }));
  }
  result[id] = { ...info, shots };
  console.log(id, JSON.stringify(result[id]));
}
fs.writeFileSync(`${out}/log.txt`, logs.join('\n'));
console.log(logs.slice(0, 20).join('\n'));
await browser.close();
