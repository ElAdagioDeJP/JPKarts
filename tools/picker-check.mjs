// V3-3 browser check: the kart selector and builder. One player (grid → builder with live bars → race with those parts),
// remembered last kart, and split screen (2 and 4 panels). Screenshots in `outDir`.
// Usage: node tools/picker-check.mjs [outDir] [--port=N]   (needs `bun run dev`)
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots-picker';
const portArg = process.argv.find((a) => a.startsWith('--port='));
const port = portArg ? Number(portArg.split('=')[1]) : 5173;
fs.mkdirSync(out, { recursive: true });
const launchOpts = { headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] };
let browser;
try { browser = await chromium.launch({ ...launchOpts, channel: 'msedge' }); } catch { browser = await chromium.launch(launchOpts); }
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/WebGPU|ShadowDepth|Destroyed/.test(m.text())) errors.push(m.text()); });
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 });
const G = (fn, arg) => page.evaluate(fn, arg);
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(140); } };
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const result = {};

// a fresh profile with no tutorial: go straight to the free-race selector
await G(() => { localStorage.removeItem('jpkart.profile'); const g = window.__jpkart; g.profile = { ...g.profile, lastCh: -1, lastParts: { body: 'kernel', wheels: 'std', wing: 'wing' } }; g.state = 'menu'; g.menuSel = 1; });
await page.waitForTimeout(500);
await key('Enter'); // menu → select
result.stateSelect = await G(() => window.__jpkart.state);
await key('ArrowRight', 2); await key('ArrowDown'); // pilot: JP's row
await shot('01-grid');
await key('Enter'); // → builder (cursor on the confirm button)
result.stateBuild = await G(() => window.__jpkart.state);
await shot('02-builder-default');
await key('ArrowUp', 2); // wheels row
await key('ArrowRight', 3); // slick → ... (cycle)
await key('ArrowUp'); // body
await key('ArrowRight'); // overdrive
await key('ArrowUp'); // wait: body is row 1, so this wraps to the confirm row
await key('ArrowDown'); // back to body... then to wing
await key('ArrowDown', 2);
await key('ArrowRight'); // glider
await shot('03-builder-custom');
result.picked = await G(() => ({ ch: window.__jpkart.pickers[0].ch, parts: window.__jpkart.pickers[0].parts, row: window.__jpkart.pickers[0].row }));
await key('KeyR'); // random
result.random = await G(() => window.__jpkart.pickers[0].parts);
await shot('04-builder-random');
// confirm: ↓ until the confirm row, then Enter
for (let i = 0; i < 6 && (await G(() => window.__jpkart.pickers[0].row)) !== 5; i++) await key('ArrowDown');
await key('Enter');
result.afterConfirm = await G(() => ({ state: window.__jpkart.state, loadouts: window.__jpkart.loadouts, lastCh: window.__jpkart.profile.lastCh, lastParts: window.__jpkart.profile.lastParts }));
// remembered: the profile is on disk
result.disk = await G(() => JSON.parse(localStorage.getItem('jpkart.profile') ?? 'null'));
// the race starts with those parts
await key('Enter');
await G(() => window.__jpkart.startRace(window.__jpkart.grid[0]));
await page.waitForFunction(() => window.__jpkart.state === 'race', null, { timeout: 180000 });
result.inRace = await G(() => { const g = window.__jpkart, k = g.world.karts[g.localId]; return { ch: k.ch, st: k.st, cfg: g.world.cfg.grid.filter((x) => x.ctrl === 'local') }; });
await G(() => { window.__jpkart.toMenu(); });
// a new selector remembers the kart
await G(() => { const g = window.__jpkart; g.state = 'menu'; g.menuSel = 1; });
await key('Enter');
result.remembered = await G(() => ({ ch: window.__jpkart.pickers[0].ch, parts: window.__jpkart.pickers[0].parts }));
await shot('05-remembered');
// split screen: 2 and 4 players
await key('KeyJ');
await shot('06-split-2');
result.panels2 = await G(() => window.__jpkart.pickers.map((p) => ({ ch: p.ch, src: p.input?.src })));
await key('KeyJ'); await key('KeyJ');
await shot('07-split-4');
result.panels4 = await G(() => window.__jpkart.pickers.map((p) => p.ch));
result.uniqueChars = new Set(result.panels4).size === 4;
// player 1 (arrows) and 2 (WASD) move their own panel at the same time
await page.keyboard.down('ArrowRight'); await page.keyboard.down('KeyD'); await page.waitForTimeout(90);
await page.keyboard.up('ArrowRight'); await page.keyboard.up('KeyD'); await page.waitForTimeout(90);
result.afterMove = await G(() => window.__jpkart.pickers.map((p) => ({ ch: p.ch, row: p.row })));
await shot('08-split-4-moved');
result.errors = errors;
console.log(JSON.stringify(result));
fs.writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 1));
await browser.close();
