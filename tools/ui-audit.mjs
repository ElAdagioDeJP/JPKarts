// Auditoría de interfaz vista por vista: captura cada pantalla y detecta texto fuera del lienzo (426×240),
// texto que se sale de su panel y textos que se pisan, instrumentando Ui.txt/txtS/panel.
// Uso: node tools/ui-audit.mjs [outDir] [--vp=1280x720] [--mobile] [--only=nombre,nombre]   (con `bun run dev` en marcha)
import { chromium } from 'playwright';
import fs from 'node:fs';

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').split('=')[1] ?? d;
const mobile = process.argv.includes('--mobile');
const [vw, vh] = arg('vp', mobile ? '844x390' : '1280x720').split('x').map(Number);
const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : `shots-ui/${mobile ? 'm' : 'd'}-${vw}x${vh}`;
const port = arg('port', '5173');
const only = arg('only', '').split(',').filter(Boolean);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const launchOpts = { headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] };
let browser;
try { browser = await chromium.launch({ ...launchOpts, channel: 'msedge' }); } catch { browser = await chromium.launch(launchOpts); }
const ctx = await browser.newContext(mobile ? { viewport: { width: vw, height: vh }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: vw, height: vh } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/?webgl` + (mobile ? '&mobile' : ''));
await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 });
await page.waitForTimeout(1200);

// instrumentation: record every text/panel of the last frames
await page.evaluate(() => {
  const g = window.__jpkart, ui = g.ui ?? g.ui_, W = 426, H = 240;
  const frames = [[]];
  window.__frames = frames;
  const cur = () => frames[frames.length - 1];
  const wrap = (name, f) => { const o = ui[name].bind(ui); ui[name] = (...a) => { const r = f(o, ...a); return r; }; };
  const ob = ui.begin.bind(ui);
  ui.begin = () => { frames.push([]); if (frames.length > 4) frames.shift(); ob(); };
  const box = (s, x, y, size, align) => {
    const w = ui.ctx.measureText(s).width;
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    const M = ui.ctx.getTransform(), k = 3; // canvas = 3 × logical; the HUD adds its own scale/translate
    return { s, x0: (M.a * x0 + M.e) / k, x1: (M.a * (x0 + w) + M.e) / k, y0: (M.d * y + M.f) / k, y1: (M.d * (y + size) + M.f) / k };
  };
  const ot = ui.txt.bind(ui), os = ui.txtS.bind(ui), op = ui.panel.bind(ui);
  ui.txt = (s, x, y, col, size = 8, align = 'left', o2) => { ot(s, x, y, col, size, align, o2); cur().push({ k: 't', ...box(String(s), x, y, size, align) }); };
  ui.txtS = (s, x, y, col, align = 'center') => { os(s, x, y, col, align); cur().push({ k: 't', ...box(String(s), x, y, 6, align) }); };
  ui.panel = (x, y, w, h, ...r) => { op(x, y, w, h, ...r); const M = ui.ctx.getTransform(); cur().push({ k: 'p', x0: (M.a * x + M.e) / 3, y0: (M.d * y + M.f) / 3, x1: (M.a * (x + w) + M.e) / 3, y1: (M.d * (y + h) + M.f) / 3 }); };
  window.__W = W; window.__H = H;
});

const issues = {};
const analyse = (fr) => {
  const W = 426, H = 240, res = [], T = fr.filter((e) => e.k === 't'), P = fr.filter((e) => e.k === 'p');
  const NAMES = new Set(['Marco', 'Guayca', 'Luis', 'Jesús', 'Miguel', 'JP', 'Mario', 'Andrés']); // etiquetas 3D sobre los karts: pueden salir de pantalla
  for (const t of T) {
    if (!NAMES.has(t.s) && (t.x0 < -0.5 || t.x1 > W + 0.5 || t.y0 < -0.5 || t.y1 > H + 0.5)) res.push(`FUERA "${t.s}" x ${t.x0.toFixed(0)}..${t.x1.toFixed(0)} y ${t.y0.toFixed(0)}..${t.y1.toFixed(0)}`);
    for (const p of P) {
      const inside = t.x0 >= p.x0 - 0.5 && t.x0 < p.x1 && t.y0 >= p.y0 - 0.5 && t.y0 < p.y1;
      if (inside && (t.x1 > p.x1 + 0.5 || t.y1 > p.y1 + 0.5) && p.x1 - p.x0 < W - 4) res.push(`SE SALE DEL PANEL "${t.s}" (${t.x1.toFixed(0)} > ${p.x1.toFixed(0)}, y1 ${t.y1.toFixed(0)} > ${p.y1.toFixed(0)})`);
    }
  }
  for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) {
    const a = T[i], b = T[j];
    const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (ix > 1 && iy > 2 && ix * iy > 0.3 * Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0)) && a.s !== b.s) res.push(`SE PISAN "${a.s}" y "${b.s}"`);
  }
  return [...new Set(res)];
};

const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(120); } };
const set = (fn, arg) => page.evaluate(fn, arg);
let n = 0;
async function shot(name, setup) {
  if (only.length && !only.includes(name)) return;
  try {
    if (setup) await setup();
    await page.waitForTimeout(700);
    const fr = await page.evaluate(() => window.__frames[window.__frames.length - 2] ?? []);
    const is = analyse(fr);
    const st = await page.evaluate(() => window.__jpkart.state);
    n++;
    const file = `${String(n).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: `${out}/${file}` });
    issues[`${String(n).padStart(2, '0')}-${name} [${st}]`] = is;
  } catch (e) { issues[name] = [`ERROR escenario: ${String(e).slice(0, 200)}`]; }
}
const go = (state, extra = {}) => () => set(({ state, extra }) => { const g = window.__jpkart; g.paused = false; g.state = state; Object.assign(g, extra); }, { state, extra });

// ---- flow screens
await shot('title', go('title'));
await shot('welcome-0', go('welcome', { welcome: { page: 0, name: '', first: true } }));
await shot('welcome-1', go('welcome', { welcome: { page: 1, name: '', first: true } }));
await shot('welcome-2', go('welcome', { welcome: { page: 2, name: 'JugadorConNombreLargo', first: true } }));
await shot('welcome-3', go('welcome', { welcome: { page: 3, name: 'Juan', first: true } }));
for (const s of [0, 1, 2, 3, 4, 5, 6, 7, 8]) await shot('menu-' + s, go('menu', { menuSel: s, welcome: null }));
for (const s of [0, 3, 6, 9]) await shot('options-' + s, go('options', { optSel: s }));
await shot('controls', go('controls', { ctlSel: 0 }));
await shot('lan', go('lan', { lanField: 0 }));
await shot('online', go('online', { onlineField: 1, onlineAddr: 'jp-kart-servidor-online.ejemplo.com', onlineCode: 'ABCD' }));
await shot('select-1p', go('select', { players: 1, sel: 5 }));
await shot('select-2p', go('select', { players: 2 }));
await shot('select-4p', go('select', { players: 4 }));
await shot('cup', go('cup', { cupSel: 0 }));
await shot('cup-2', go('cup', { cupSel: 2 }));
await shot('track-0', go('track', { trackSel: 0, classic: false, mode: 'free' }));
await shot('track-last', go('track', { trackSel: 15, classic: false, mode: 'free' }));
await shot('track-classic', go('track', { trackSel: 3, classic: true, mode: 'free' }));
await shot('track-arena', go('track', { trackSel: 1, mode: 'battle' }));

// ---- races: real flow through the menu, one per mode
const toMenu = () => page.evaluate(() => { const g = window.__jpkart; g.paused = false; g.world = null; g.state = 'menu'; g.cup = null; g.net = null; g.replayView = null; g.mode = 'free'; g.players = 1; g.classic = false; g.welcome = null; g.single(); g.renderer.clearKarts?.(); });
const inRace = (ph = 'race') => page.waitForFunction((ph) => window.__jpkart.state === 'race' && window.__jpkart.world?.phase === ph, ph, { timeout: 120000 }).catch(() => {});
async function startMode(menuSel, { slot = 6, keys = [], players = 1 } = {}) {
  await toMenu();
  await page.evaluate(([m, p]) => { const g = window.__jpkart; g.menuSel = m; g.players = p; }, [menuSel, players]);
  await key('Enter'); // → select
  await page.evaluate((p) => { window.__jpkart.players = p; }, players);
  await key('Enter'); // → track (or cup)
  for (const k of keys) await key(k);
  await page.evaluate((s) => { window.__jpkart.trackSel = s; window.__jpkart.cupSel = 0; }, slot);
  await key('Enter');
}
async function finishRace() {
  await page.evaluate(() => { const g = window.__jpkart, w = g.world; w.karts.forEach((k, i) => { k.prog = w.cfg.laps * g.tr.N - 3 - i * 2; }); });
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => window.__jpkart.state === 'results' || window.__jpkart.state === 'standings', null, { timeout: 90000 }).catch(() => {});
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(800);
}

try {
// free race (1 player) — HUD, items, banners, pause, results, podium, replay
await startMode(1);
await shot('loading', null);
await inRace('countdown'); await shot('countdown');
await inRace();
await page.keyboard.down('ArrowUp'); await page.waitForTimeout(3500);
await shot('race');
await shot('race-item', () => set(() => { const g = window.__jpkart; g.local.item = 'forkbomb'; g.local.coins = 12; g.local.itemCount = 3; }));
await shot('race-banner', () => set(() => { const g = window.__jpkart; g.banner = { t: '¡Última vuelta!', life: 4, big: true }; }));
await shot('race-pause', () => set(() => { window.__jpkart.paused = true; }));
await set(() => { window.__jpkart.paused = false; });
await page.keyboard.up('ArrowUp');
await finishRace();
await shot('results');
await key('KeyR'); await page.waitForTimeout(2500); await shot('replay');
await key('Enter'); await page.waitForTimeout(800);
await shot('results-2', () => set(() => { const g = window.__jpkart; if (g.state !== 'results') g.state = 'results'; }));
await key('Enter'); await shot('podium');

// other modes' HUDs
for (const [name, sel, keys, slot] of [['timetrial', 2, [], 6], ['elimination', 3, [], 6], ['battle', 4, [], 1], ['capture', 4, ['KeyC'], 1]]) {
  await startMode(sel, { keys, slot });
  await inRace(); await page.keyboard.down('ArrowUp'); await page.waitForTimeout(3500);
  await shot('mode-' + name);
  await page.keyboard.up('ArrowUp');
}
// split screen 2 and 4 players
for (const p of [2, 4]) {
  await startMode(1, { players: p });
  await inRace(); await page.waitForTimeout(3000);
  await shot('split-' + p + 'p');
}
// cup: standings (mid cup) and final (last race)
await startMode(0);
await inRace(); await finishRace();
await shot('cup-results');
await key('Enter'); await page.waitForTimeout(800);
await shot('cup-standings');
await page.evaluate(() => { const g = window.__jpkart; g.cup.race = g.cup.def.tracks.length - 1; g.state = 'standings'; });
await key('Enter'); await page.waitForTimeout(1200);
await shot('cup-final');
await toMenu();
} catch (e) { console.log('ABORTADO:', String(e).slice(0, 300), '| url', page.url()); }

fs.writeFileSync(`${out}/issues.json`, JSON.stringify({ viewport: `${vw}x${vh}`, mobile, errors, issues }, null, 2));
let bad = 0;
for (const [k, v] of Object.entries(issues)) if (v.length) { bad++; console.log(`✗ ${k}\n   ${v.join('\n   ')}`); }
console.log(`${Object.keys(issues).length} pantallas · ${bad} con problemas · errores JS: ${errors.length ? errors.join(' | ') : 'ninguno'} · capturas en ${out}`);
await browser.close();
