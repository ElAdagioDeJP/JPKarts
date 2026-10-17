// QA de la banda grabada: menú -> pista, comprueba qué canción suena (archivo, decodificada, tasa) y que el SFX de objeto no falla.
// Uso: node tools/songs-check.mjs --track-slot=5   (con `bun run dev` en marcha)
import { chromium } from 'playwright';

const slotArg = process.argv.find((a) => a.startsWith('--track-slot='));
const slot = slotArg ? Number(slotArg.split('=')[1]) : 0;
const launchOpts = { headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-webgpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] };
let browser;
try { browser = await chromium.launch({ ...launchOpts, channel: 'msedge' }); } catch { browser = await chromium.launch(launchOpts); }
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errs.push(`[console] ${m.text()}`); });
await page.goto('http://localhost:5173/?webgl');
await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 });
const now = () => page.evaluate(() => {
  const a = window.__jpkart.audio, s = a.fileSrc;
  return { state: window.__jpkart.state, file: s?.name ?? null, rate: s ? +s.src.playbackRate.value.toFixed(3) : null, loop: s?.src.loop ?? null, decoded: [...a.files].map(([k, v]) => k + ':' + (v ? Math.round(v.duration) + 's' : String(v))) };
});
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(120); } };
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
console.log('welcome', JSON.stringify(await now()));
await page.evaluate(() => { window.__jpkart.state = 'menu'; window.__jpkart.welcome = null; }); // salta la bienvenida
await page.waitForTimeout(1500);
console.log('menu', JSON.stringify(await now()));
await key('ArrowDown'); await key('Enter'); await key('Enter'); await key('ArrowRight', slot); await key('Enter');
await page.waitForFunction(() => window.__jpkart.state === 'race' && window.__jpkart.world?.phase === 'race', null, { timeout: 60000 });
await page.waitForTimeout(2500);
console.log('race', await page.evaluate(() => window.__jpkart.tr.def.id), JSON.stringify(await now()));
// SFX: every item recipe must run without throwing
const sfx = await page.evaluate(async () => {
  const m = await import('/src/feel/itemSfx.ts'); const a = window.__jpkart.audio; let n = 0;
  for (const id of ['bocina', 'falsa', 'turbo3', 'ciego3', 'ciego', 'bumeran', 'bumeranR', 'iman', 'cadena', 'hielo', 'humo', 'rafaga', 'bala', 'goma', 'burbuja', 'nitro', 'alquitran', 'dron', 'gancho', 'inversor', 'pem', 'jugger', 'agujero', 'overclock', 'forkbomb', 'antivirus', 'lagspike', 'cuantico', 'mina', 'muelle', 'reflector', 'xx']) { m.itemSfx(a, id, 40, 0.5, true); n++; }
  m.hitImpact(a, 0, 0); return n;
});
console.log('sfx recipes played:', sfx);
console.log(errs.length ? errs.join('\n') : 'no errors');
await browser.close();
