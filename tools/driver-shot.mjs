// V3-6 browser check: one pilot (default JP) in a free race, from behind and from the front (replay-style camera), plus console errors.
// Usage: node tools/driver-shot.mjs [outDir] [--ch=5] [--port=N]   (needs `bun run dev`)
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots/v3-models';
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? Number(a.split('=')[1]) : d; };
const ch = arg('ch', 5), port = arg('port', 5173), tag = process.argv.find((a) => a.startsWith('--tag='))?.slice(6) ?? `ch${ch}`;
fs.mkdirSync(out, { recursive: true });
const launchOpts = { headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] };
let browser;
try { browser = await chromium.launch({ ...launchOpts, channel: 'msedge' }); } catch { browser = await chromium.launch(launchOpts); }
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/WebGPU|ShadowDepth|Destroyed/.test(m.text())) errors.push(m.text()); });
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 });
const G = (fn, a) => page.evaluate(fn, a);
await G((c) => { const g = window.__jpkart; g.sel = c; g.loadouts = [{ ch: c, parts: { body: 'kernel', wheels: 'std', wing: 'wing' } }]; g.state = 'menu'; g.menuSel = 1; }, ch);
await page.waitForTimeout(400);
await G(() => { const g = window.__jpkart; g.startRace(g.grid[0]); });
await page.waitForFunction(() => window.__jpkart.state === 'race', null, { timeout: 180000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/${tag}-grid.png` });
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(7000);
await page.keyboard.down('ArrowLeft');
await page.waitForTimeout(2500);
const sv = await G(() => { const g = window.__jpkart; return g.world?.karts?.[g.localId]?.sv; });
console.log('sv with ArrowLeft', sv);
await page.screenshot({ path: `${out}/${tag}-steerL.png` });
await page.screenshot({ path: `${out}/${tag}-steerL-crop.png`, clip: { x: 440, y: 250, width: 400, height: 290 } });
await page.keyboard.up('ArrowLeft'); await page.keyboard.down('ArrowRight');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/${tag}-steerR.png` });
await page.screenshot({ path: `${out}/${tag}-steerR-crop.png`, clip: { x: 440, y: 250, width: 400, height: 290 } });
await page.keyboard.up('ArrowRight');
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/${tag}-straight.png` });
await page.screenshot({ path: `${out}/${tag}-straight-crop.png`, clip: { x: 440, y: 250, width: 400, height: 290 } });
const kinds = await G(() => window.__jpkart.renderer.modelKinds?.());
console.log(JSON.stringify({ kinds, errors, fps: await G(() => window.__jpkart.perf().fps) }));
await page.keyboard.up('ArrowUp');
await browser.close();
