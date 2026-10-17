// Smoke test in a real browser: boots the client, drives menus, takes screenshots.
// Usage: node tools/shot.mjs [outDir] [--webgl] [--race-seconds=N] [--mobile] [--track-slot=N] [--port=N]
// M5 móvil: --mobile emula 844×390 táctil (isMobile + touch) y vuelca el estado táctil.
import { chromium } from 'playwright';
import fs from 'node:fs';

const mobile = process.argv.includes('--mobile');
const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : mobile ? 'shots-mobile' : 'shots';
const webgl = process.argv.includes('--webgl');
const raceArg = process.argv.find((a) => a.startsWith('--race-seconds='));
const raceSeconds = raceArg ? Number(raceArg.split('=')[1]) : 6;
const slotArg = process.argv.find((a) => a.startsWith('--track-slot='));
const trackSlot = slotArg ? Number(slotArg.split('=')[1]) : 0;
const portArg = process.argv.find((a) => a.startsWith('--port='));
const port = portArg ? Number(portArg.split('=')[1]) : 5173;
fs.mkdirSync(out, { recursive: true });

const launchOpts = { headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=d3d11', '--ignore-gpu-blocklist'] };
let browser;
try { browser = await chromium.launch({ ...launchOpts, channel: 'msedge' }); }
catch { browser = await chromium.launch(launchOpts); }
const context = await browser.newContext(mobile
  ? { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
  : { viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const qs = [webgl ? 'webgl' : '', mobile ? 'mobile' : ''].filter(Boolean).join('&');
await page.goto(`http://localhost:${port}/` + (qs ? '?' + qs : ''));
await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 });
const backend = await page.evaluate(() => window.__jpkart.renderer.backend);
const mobileState = mobile ? await page.evaluate(() => ({
  bodyMobile: document.body.classList.contains('mobile'),
  touchEl: !!document.querySelector('#touch'),
  tier: window.__jpkart.renderer.tier,
  hudScale: window.__jpkart.settings.hudScale,
})) : null;
if (mobileState) console.log('mobile', JSON.stringify(mobileState));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/01-title.png` });
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(150); } };
const cur = () => page.evaluate(() => window.__jpkart.state);
// Sin GPU los primeros frames compilan shaders y el input va con retardo:
// se pulsa hasta llegar al estado querido en vez de contar teclas a ciegas.
const pressUntil = async (k, want, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    if ((await cur()) === want) return true;
    await key(k);
  }
  return (await cur()) === want;
};
// Primera ejecución (perfil fresco): saltar el tutorial y poner nombre.
if ((await cur()) === 'welcome') {
  await key('Escape'); // tutorial → página de nombre
  await page.waitForTimeout(400);
  await page.keyboard.type('Movil');
  await pressUntil('Enter', 'title');
  await page.waitForTimeout(300);
}
await pressUntil('Enter', 'menu'); // title → menu
// Carrera libre (menuSel 1): se verifica, no se supone.
for (let i = 0; i < 10; i++) {
  const sel = await page.evaluate(() => window.__jpkart.menuSel);
  if (sel === 1) break;
  await key(sel > 1 ? 'ArrowUp' : 'ArrowDown');
}
await pressUntil('Enter', 'select'); // menu → pilotos
await page.screenshot({ path: `${out}/02-select.png` });
await pressUntil('Enter', 'track'); // pilotos → pista
await key('ArrowRight', trackSlot);
await page.screenshot({ path: `${out}/03-track.png` });
await key('Enter'); // start race (loading → race; la pista compila shaders)
await page.waitForFunction(() => window.__jpkart.state === 'race', null, { timeout: 180000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/04-countdown.png` });
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(raceSeconds * 1000);
await page.screenshot({ path: `${out}/05-race.png` });
if (mobile) {
  // M1: un tap en la zona del joystick ejercita la ruta pointer (sin romper el teclado).
  try { await page.touchscreen.tap(150, 280); } catch { /* ratón en su lugar */ }
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/05b-touch.png` });
}
await page.keyboard.down('ArrowRight');
await page.keyboard.down('ShiftLeft');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/06-drift.png` });
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('ArrowRight');
await key('F2');
await page.waitForTimeout(1500);
const stats = await page.evaluate(() => { const g = window.__jpkart; return { ...g.perf(), state: g.state, phase: g.world?.phase, speed: g.local?.speed, prog: g.local?.prog, rank: g.local?.rank }; });
await page.screenshot({ path: `${out}/07-perf.png` });
if (process.argv.includes('--debug')) { await key('F2'); await key('F3'); await key('F4'); await page.waitForTimeout(800); await page.screenshot({ path: `${out}/08-debug.png` }); await key('F3'); await key('F4'); }
await page.keyboard.up('ArrowUp');
await key('KeyP'); // pause so the replay and the hash describe the same tick
const dbg = await page.evaluate(() => window.__jpkart.debugReplay());
fs.writeFileSync(`${out}/replay.json`, JSON.stringify(dbg.replay));
fs.writeFileSync(`${out}/replay-hash.txt`, dbg.hash);
fs.writeFileSync(`${out}/log.txt`, `backend=${backend}\n${JSON.stringify(stats)}\n` + logs.join('\n'));
console.log('backend', backend, JSON.stringify(stats));
console.log(logs.slice(0, 30).join('\n'));
await browser.close();
