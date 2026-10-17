// V3-6b: the 3D podium (rigged pilots on pedestals at the start line). Usage: node tools/podium-shot.mjs [outDir] [--chs=5,0,8] [--port=N]   (needs `bun run dev`)
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots/v3-models';
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const chs = arg('chs', '5,0,8').split(',').map(Number), port = Number(arg('port', 5173)), tag = arg('tag', 'podium');
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
await page.evaluate((c) => { const g = window.__jpkart; g.sel = c; g.loadouts = [{ ch: c, parts: { body: 'kernel', wheels: 'std', wing: 'wing' } }]; g.state = 'menu'; g.menuSel = 1; }, chs[0]);
await page.waitForTimeout(400);
await page.evaluate(() => { const g = window.__jpkart; g.startRace(g.grid[0]); });
await page.waitForFunction(() => window.__jpkart.state === 'race', null, { timeout: 180000 });
await page.waitForTimeout(2500);
await page.evaluate((chs) => { const g = window.__jpkart, w = g.world; w.finalOrder = chs.map((ch) => w.karts.find((k) => k.ch === ch).id); g.state = 'podium'; }, chs);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/${tag}.png` });
console.log(JSON.stringify({ errors }));
await browser.close();
