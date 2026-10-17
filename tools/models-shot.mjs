// V3-6b review: the 12 pilots (V3-6 .glb karts) rendered by the game itself, from behind, from the front and in 3/4, plus the victory pose.
// Freezes the game loop on the start grid, then draws one kart at a time with a free camera. Output: <out>/<id>-<view>.png
// Usage: node tools/models-shot.mjs [outDir] [--port=N] [--parts=body,wheels,wing] [--only=ch,ch]   (needs `bun run dev`)
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots/v3-models';
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const port = Number(arg('port', 5173));
const [body, wheels, wing] = arg('parts', 'kernel,std,wing').split(',');
const only = arg('only', '') ? arg('only', '').split(',').map(Number) : null;
const IDS = ['marco', 'guaycaipuro', 'luis', 'jesus', 'miguel', 'jp', 'mario', 'andres', 'edu', 'diego', 'angel', 'henry'];
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
await page.evaluate((c) => { const g = window.__jpkart; g.sel = c; g.loadouts = [{ ch: c, parts: { body: 'kernel', wheels: 'std', wing: 'wing' } }]; g.state = 'menu'; g.menuSel = 1; }, 5);
await page.waitForTimeout(400);
await page.evaluate(() => { const g = window.__jpkart; g.startRace(g.grid[0]); });
await page.waitForFunction(() => window.__jpkart.state === 'race', null, { timeout: 180000 });
await page.waitForTimeout(2500);
// wait until every .glb has loaded, then freeze the loop and keep only the 3D canvas
await page.waitForFunction(() => { const m = window.__jpkart.renderer.models; return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].every((ch) => m.ready(ch, { body: 'kernel', wheels: 'std', wing: 'wing' })); }, null, { timeout: 60000 });
await page.evaluate(() => {
  const dom = window.__jpkart.renderer.renderer.domElement;
  document.querySelectorAll('canvas').forEach((c) => { if (c !== dom) c.style.display = 'none'; });
  document.body.style.background = '#000';
});
await page.waitForTimeout(300);
const box = await page.evaluate(() => { const r = window.__jpkart.renderer.renderer.domElement.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });

const base = await page.evaluate(() => { const g = window.__jpkart, ps = g.pose(g.world.karts[g.localId]); return { x: ps.x, y: ps.y, z: ps.z, a: ps.a, cam: { ...g.cam } }; });
const shoot = async (ch, view, win, ms) => {
  await page.evaluate(([ch, view, win, parts, base]) => {
    const g = window.__jpkart, ps = base;
    const fx = Math.cos(ps.a), fy = Math.sin(ps.a);
    const d = view === 'rear' ? -22 : 22, side = view === '34' ? 14 : 0;
    const cx = ps.x + fx * d - fy * side, cy = ps.y + fy * d + fx * side;
    const cam = { ...base.cam, x: cx, y: cy, z: ps.z + 7, a: view === 'rear' ? ps.a : Math.atan2(ps.y - cy, ps.x - cx) };
    const kv = { id: ch, ch, x: ps.x, y: ps.y, z: ps.z, a: ps.a, lean: 0, hop: 0, spin: 0, big: false, bubble: false, reflect: false, visible: true, ground: ps.z, air: false, glide: false, speed: 0, trick: 0, squash: 0, local: false, parts, win };
    g.showcase = { cam, views: [kv] };
  }, [ch, view, win, { body, wheels, wing }, base]);
  await page.waitForTimeout(ms);
};
for (let ch = 0; ch < 12; ch++) {
  if (only && !only.includes(ch)) continue;
  for (const view of ['rear', 'front', '34']) { await shoot(ch, view, false, 350); await page.screenshot({ path: `${out}/${IDS[ch]}-${view}.png`, clip: box }); }
  await shoot(ch, '34', true, 1800);
  await page.screenshot({ path: `${out}/${IDS[ch]}-victory.png`, clip: box });
}
console.log(JSON.stringify({ errors, box }));
await browser.close();
