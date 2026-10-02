// Dev check: editing a tunables JSON on disk reaches the running game without a page reload.
import { chromium } from 'playwright';
import fs from 'node:fs';

const file = 'packages/core/data/tunables/driving.json';
const original = fs.readFileSync(file, 'utf8');
let browser;
try { browser = await chromium.launch({ headless: true, channel: 'msedge' }); } catch { browser = await chromium.launch({ headless: true }); }
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(m.text()));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 });
await page.evaluate(() => { window.__marker = 1; });
try {
  fs.writeFileSync(file, original.replace('"baseSpeed": 142', '"baseSpeed": 150'));
  await page.waitForFunction(() => window.__jpkart && window.__marker === 1 && (window.__jpkartLastToast ?? '').length >= 0, null, { timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const ok = logs.some((l) => l.includes('Tunables "driving" recargados'));
  const sameDoc = await page.evaluate(() => window.__marker === 1);
  console.log(JSON.stringify({ hotReloaded: ok, noPageReload: sameDoc }));
  if (!ok || !sameDoc) process.exitCode = 1;
} finally {
  fs.writeFileSync(file, original);
  await browser.close();
}
