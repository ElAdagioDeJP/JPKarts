// QA del roster full-3D + proyectil ciego 3D en navegador real.
// Uso: node tools/roster-check.mjs [outDir]
// Arranca una carrera, fuerza los 8 ch en el renderer y comprueba qué modelo
// lleva cada uno (ext/code/voxel), dispara un ciego y cuenta meshes del pool.
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots-roster';
fs.mkdirSync(out, { recursive: true });

const launchOpts = { headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=d3d11', '--ignore-gpu-blocklist'] };
let browser;
try { browser = await chromium.launch({ ...launchOpts, channel: 'msedge' }); }
catch { browser = await chromium.launch(launchOpts); }
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.text().includes('pageerror')) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:5173/?webgl');
await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 });
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(120); } };
await key('Enter');
await key('ArrowDown');
await key('Enter');
await key('Enter');
await key('Enter');
await page.waitForFunction(() => window.__jpkart.state === 'race' && window.__jpkart.world?.phase === 'race', null, { timeout: 60000 });
await page.waitForTimeout(1000);
// 1) los 8 ch resuelven modelo sin voxel
const kinds = await page.evaluate(() => {
  const g = window.__jpkart;
  for (let ch = 0; ch < 8; ch++) g.renderer.kartObj(900 + ch, ch);
  return g.renderer.modelKinds();
});
const forced = Object.fromEntries(Object.entries(kinds).filter(([id]) => Number(id) >= 900).map(([id, v]) => [v.ch, v.model]));
// 2) ciego 3D en vivo: item forzado + uso + contar pool visible
await page.evaluate(() => { window.__jpkart.local.item = 'ciego'; });
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(500);
await page.keyboard.press('Space');
await page.waitForTimeout(120);
const shot = await page.evaluate(() => {
  const r = window.__jpkart.renderer;
  return { pool: r.shotPool.length, visible: r.shotPool.filter((m) => m.visible).length, geo: !!r.shotGeo };
});
await page.screenshot({ path: `${out}/roster.png` });
const perf = await page.evaluate(() => ({ ...window.__jpkart.perf(), state: window.__jpkart.state }));
await page.keyboard.up('ArrowUp');
fs.writeFileSync(`${out}/roster.json`, JSON.stringify({ kinds: forced, shot, perf, errors: logs }, null, 1));
console.log(JSON.stringify({ kinds: forced, shot, perf, errors: logs }));
await browser.close();
