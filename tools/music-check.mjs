// QA de banda sonora por pista: entra en carrera y vuelca qué suena
// (canción, transposición, stem de bioma, tempo).
// Uso: node tools/music-check.mjs --track-slot=5
import { chromium } from 'playwright';

const slotArg = process.argv.find((a) => a.startsWith('--track-slot='));
const slot = slotArg ? Number(slotArg.split('=')[1]) : 0;

const launchOpts = { headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=d3d11', '--ignore-gpu-blocklist'] };
let browser;
try { browser = await chromium.launch({ ...launchOpts, channel: 'msedge' }); }
catch { browser = await chromium.launch(launchOpts); }
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:5173/?webgl');
await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 });
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(120); } };
await key('Enter');
await key('ArrowDown');
await key('Enter');
await key('Enter');
await key('ArrowRight', slot);
await key('Enter');
await page.waitForFunction(() => window.__jpkart.state === 'race' && window.__jpkart.world?.phase === 'race', null, { timeout: 60000 });
await page.waitForTimeout(2500);
const st = await page.evaluate(() => {
  const g = window.__jpkart;
  return { track: g.tr.def.id, music: g.audio.musicState(), intensity: g.audio.intensity };
});
console.log(JSON.stringify({ ...st, errors: logs }));
await browser.close();
