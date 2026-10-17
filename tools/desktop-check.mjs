// Electron check: launches the built desktop app, hosts a LAN game, discovers it over UDP, joins the lobby.
// Usage: node tools/desktop-check.mjs [outDir] [--exe path/to/JP-Kart.exe]
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots';
fs.mkdirSync(out, { recursive: true });
const exeArg = process.argv.indexOf('--exe');
const appDir = path.resolve('apps/desktop');
const app = exeArg > 0
  ? await electron.launch({ executablePath: path.resolve(process.argv[exeArg + 1]) })
  : await electron.launch({ executablePath: path.join(appDir, 'node_modules/electron/dist/electron.exe'), args: [appDir] });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
try { await win.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 }); }
catch (e) { await win.screenshot({ path: `${out}/desk-fail.png` }); console.log('NO ARRANCA', await win.evaluate(() => document.body.innerText.slice(0, 500)), errors); await app.close(); process.exit(1); }
const backend = await win.evaluate(() => window.__jpkart.renderer.backend);
const bridge = await win.evaluate(() => typeof window.jpkartDesktop?.host === 'function');
await win.waitForTimeout(1500);
await win.screenshot({ path: `${out}/desk-1-title.png` });
const host = await win.evaluate(() => window.jpkartDesktop.host('Prueba'));
await win.waitForTimeout(2500);
const found = await win.evaluate(() => window.jpkartDesktop.discover());
await win.evaluate(() => window.__jpkart.connectLan('localhost', 'Anfitrión'));
await win.waitForFunction(() => window.__jpkart.net?.status === 'lobby' && window.__jpkart.net.players.length > 0, null, { timeout: 20000 });
await win.screenshot({ path: `${out}/desk-2-lobby.png` });
// V3-6b: the .glb karts load under app:// (fetch of local files): start a race and ask the renderer which models it mounted
await win.evaluate(() => { const g = window.__jpkart; g.sel = 5; g.loadouts = [{ ch: 5, parts: { body: 'rover', wheels: 'offroad', wing: 'glider' } }]; g.state = 'menu'; g.menuSel = 1; });
await win.evaluate(() => { const g = window.__jpkart; g.startRace(g.grid[0]); });
await win.waitForFunction(() => window.__jpkart.state === 'race', null, { timeout: 120000 });
await win.waitForFunction(() => Object.values(window.__jpkart.renderer.modelKinds()).filter((k) => k.model === 'rig').length >= 12, null, { timeout: 30000 }).catch(() => {});
const kinds = await win.evaluate(() => Object.values(window.__jpkart.renderer.modelKinds()).map((k) => k.model));
await win.screenshot({ path: `${out}/desk-3-race.png` });
await win.evaluate(() => window.__jpkart.toMenu());
const stored = await win.evaluate(async () => { await window.jpkartDesktop.write('check', '{"ok":1}'); return window.jpkartDesktop.read('check'); });
console.log(JSON.stringify({ backend, bridge, host, found, stored, rigs: kinds.filter((k) => k === 'rig').length + '/' + kinds.length, errors }));
await win.evaluate(() => window.jpkartDesktop.stopHost());
await app.close();
