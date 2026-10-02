// Phase 8 visual check of the items: free race on a track slot, give each item to the local kart, use it, screenshot.
// Usage: node tools/items-shots.mjs [outDir] [item,item,...] [--slot=N]
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots-items';
const items = (process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'falsa,turbo3,hielo,humo,iman,bumeran,ciego3,rafaga,cadena,bala').split(',');
const slotArg = process.argv.find((a) => a.startsWith('--slot='));
const slot = slotArg ? Number(slotArg.split('=')[1]) : 1;
fs.mkdirSync(out, { recursive: true });

const launchOpts = { headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=d3d11', '--ignore-gpu-blocklist'] };
let browser;
try { browser = await chromium.launch({ ...launchOpts, channel: 'msedge' }); }
catch { browser = await chromium.launch(launchOpts); }
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 });
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(100); } };
await key('Enter'); await key('ArrowDown'); await key('Enter'); await key('Enter');
await page.evaluate((s) => { const g = window.__jpkart; g.classic = false; g.trackSel = s; }, slot);
await key('Enter');
await page.waitForFunction(() => window.__jpkart.world?.phase === 'race', null, { timeout: 60000 });
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(4000);
for (const id of items) {
  const ok = await page.evaluate((it) => {
    const g = window.__jpkart, k = g.local, w = g.world;
    // keep the pack close so area items have targets
    for (const o of w.karts) if (o !== k && o.ai) { o.x = k.x + Math.cos(k.a) * (30 + o.id * 9) - Math.sin(k.a) * ((o.id % 3) - 1) * 16; o.y = k.y + Math.sin(k.a) * (30 + o.id * 9) + Math.cos(k.a) * ((o.id % 3) - 1) * 16; o.idx = k.idx + 5 + o.id; o.prog = k.prog + 5 + o.id; o.coins = 4; }
    k.item = it; k.itemN = it === 'turbo3' || it === 'ciego3' ? 3 : 1; k.roll = 0;
    if (it === 'ciego3') k.fx.push({ type: 'orbit', t: 1, src: k.id, data: 0 });
    return true;
  }, id);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${id}-0-held.png` });
  await key('Space');
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/${id}-1-used.png` });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${id}-2-after.png` });
  console.log(id, ok);
}
fs.writeFileSync(`${out}/log.txt`, logs.join('\n'));
console.log(logs.slice(0, 20).join('\n'));
await browser.close();
