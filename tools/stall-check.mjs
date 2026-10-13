import { chromium } from 'playwright';
const launchOpts = { headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=d3d11', '--ignore-gpu-blocklist'] };
let browser;
try { browser = await chromium.launch({ ...launchOpts, channel: 'msedge' }); }
catch { browser = await chromium.launch(launchOpts); }
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173/?webgl');
await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 });
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(120); } };
await key('Enter'); await key('ArrowDown'); await key('Enter'); await key('Enter'); await key('Enter');
await page.waitForFunction(() => window.__jpkart.state === 'race' && window.__jpkart.world?.phase === 'race', null, { timeout: 60000 });
await page.evaluate(() => { const g = window.__jpkart, k = g.local; k.air = true; k.glide = true; k.speed = 10; k.vz = 0; k.z += 120; });
const seen = [];
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(200);
  const b = await page.evaluate(() => window.__jpkart.banner);
  if (b) seen.push(JSON.stringify(b));
  if (i === 2) await page.screenshot({ path: 'C:/Users/juanr/AppData/Local/Temp/opencode/stall.png' });
}
console.log('banners=' + JSON.stringify(seen) + ' errors=' + JSON.stringify(errs));
await browser.close();
