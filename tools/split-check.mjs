// Phase 10 browser check: local split screen with 2 and 4 players (keyboard halves + no pads in headless),
// both players drive (arrows / WASD), fps with each layout. Usage: node tools/split-check.mjs [outDir] [--webgl]
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots-split';
const webgl = process.argv.includes('--webgl');
fs.mkdirSync(out, { recursive: true });
const launchOpts = { headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=d3d11', '--ignore-gpu-blocklist'] };
let browser;
try { browser = await chromium.launch({ ...launchOpts, channel: 'msedge' }); }
catch { browser = await chromium.launch(launchOpts); }
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:5173/' + (webgl ? '?webgl' : ''));
await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 });
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(110); } };
const result = { backend: await page.evaluate(() => window.__jpkart.renderer.backend) };

for (const n of [2, 4]) {
  await page.evaluate(() => { const g = window.__jpkart; g.world = null; g.paused = false; g.state = 'menu'; g.menuSel = 1; });
  await key('Enter'); // → select
  await page.evaluate((n) => { window.__jpkart.players = n; }, n);
  await page.screenshot({ path: `${out}/${n}p-select.png` });
  await key('Enter'); await page.evaluate(() => { window.__jpkart.trackSel = 0; }); await key('Enter');
  await page.waitForFunction(() => window.__jpkart.world?.phase === 'race', null, { timeout: 60000 });
  // player 1 on the arrows, player 2 on WASD: both accelerate
  await page.keyboard.down('ArrowUp'); await page.keyboard.down('KeyW');
  await page.waitForTimeout(4000);
  await page.keyboard.up('ArrowUp'); await page.keyboard.up('KeyW');
  await page.screenshot({ path: `${out}/${n}p-race.png` });
  result[n + 'p'] = await page.evaluate(() => {
    const g = window.__jpkart;
    return { views: g.views.length, prog: g.views.map((v) => g.world.karts[v.localId].prog), fps: g.perf().fps, render: g.perf().render, sources: g.views.map((v) => v.input?.src) };
  });
  await key('KeyP'); await key('Escape');
}
result.errors = errors;
fs.writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
await browser.close();
