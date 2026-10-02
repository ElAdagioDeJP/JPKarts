// Smoke test in a real browser: boots the client, drives menus, takes screenshots.
// Usage: node tools/shot.mjs [outDir] [--webgl] [--race-seconds=N]
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots';
const webgl = process.argv.includes('--webgl');
const raceArg = process.argv.find((a) => a.startsWith('--race-seconds='));
const raceSeconds = raceArg ? Number(raceArg.split('=')[1]) : 6;
fs.mkdirSync(out, { recursive: true });

const launchOpts = { headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=d3d11', '--ignore-gpu-blocklist'] };
let browser;
try { browser = await chromium.launch({ ...launchOpts, channel: 'msedge' }); }
catch { browser = await chromium.launch(launchOpts); }
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:5173/' + (webgl ? '?webgl' : ''));
await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 });
const backend = await page.evaluate(() => window.__jpkart.renderer.backend);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/01-title.png` });
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(120); } };
await key('Enter'); // title → menu
await key('ArrowDown'); // carrera libre
await key('Enter'); // → select
await page.screenshot({ path: `${out}/02-select.png` });
await key('Enter'); // → track
await page.screenshot({ path: `${out}/03-track.png` });
await key('Enter'); // start race (track 0, built)
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/04-countdown.png` });
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(raceSeconds * 1000);
await page.screenshot({ path: `${out}/05-race.png` });
await page.keyboard.down('ArrowRight');
await page.keyboard.down('ShiftLeft');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/06-drift.png` });
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('ArrowRight');
await key('F2');
await page.waitForTimeout(1500);
const stats = await page.evaluate(() => { const g = window.__jpkart; return { fps: g.fps, sim: g.simMs, render: g.renderMs, state: g.state, phase: g.world?.phase, speed: g.local?.speed, prog: g.local?.prog, rank: g.local?.rank }; });
await page.screenshot({ path: `${out}/07-perf.png` });
fs.writeFileSync(`${out}/log.txt`, `backend=${backend}\n${JSON.stringify(stats)}\n` + logs.join('\n'));
console.log('backend', backend, JSON.stringify(stats));
console.log(logs.slice(0, 30).join('\n'));
await browser.close();
