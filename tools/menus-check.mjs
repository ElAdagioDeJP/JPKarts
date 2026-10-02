// Screenshots of the options and controls screens; checks that settings persist across a reload.
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] ?? 'shots';
fs.mkdirSync(out, { recursive: true });
let browser;
try { browser = await chromium.launch({ headless: true, channel: 'msedge' }); } catch { browser = await chromium.launch({ headless: true }); }
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 });
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(90); } };
await key('Enter'); // title → menu
await key('ArrowUp'); // the last entry: Opciones
await page.screenshot({ path: `${out}/m1-menu.png` });
await key('Enter'); // options
await key('ArrowDown', 4); // colorblind
await key('ArrowRight');
await page.screenshot({ path: `${out}/m2-options.png` });
await key('ArrowDown', 4); // controls
await key('Enter');
await page.screenshot({ path: `${out}/m3-controls.png` });
await key('Enter'); // remap "acelerar"
await key('KeyI');
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/m4-remapped.png` });
await page.reload();
await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 });
const persisted = await page.evaluate(() => ({ colorblind: window.__jpkart.settings.colorblind, acelerar: window.__jpkart.input.bindings.acelerar }));
console.log(JSON.stringify({ persisted, errors }));
await browser.close();
