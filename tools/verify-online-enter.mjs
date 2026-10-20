// E2E local del flujo real por teclado: welcome -> menu -> online -> crear -> lobby -> Enter -> race.
// Uso: bun tools/verify-online-enter.mjs   (necesita `bun run dev` en :5173)
import { chromium } from 'playwright';
import { startOnlineServer } from '../packages/server/src/online.ts';

const PORT = 7799;
const on = startOnlineServer(PORT, () => {});
let browser;
try { browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-unsafe-webgpu'] }); } catch { browser = await chromium.launch({ headless: true }); }
const errors = [];
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => errors.push('page: ' + e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000 });

const st = (expr) => page.evaluate(expr);
// welcome: avanzar hasta la página del nombre (polling, no conteo fijo)
for (let i = 0; i < 10; i++) {
  const p = await st(() => ({ s: window.__jpkart.state, pg: window.__jpkart.welcome?.page }));
  if (p.s !== 'welcome') break;
  if ((p.pg ?? 0) >= 5) break;
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
}
// nombre: limpiar y escribir
await page.evaluate(() => { window.__jpkart.welcome.name = ''; });
await page.keyboard.type('Juan', { delay: 30 });
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
console.log('tras welcome:', await st(() => window.__jpkart.state));
// a menú si quedó en título
for (let i = 0; i < 3; i++) {
  if ((await st(() => window.__jpkart.state)) === 'menu') break;
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
}
// menu -> online (el cursor puede no estar en 0: se fija en 5)
await page.evaluate(() => { window.__jpkart.menuSel = 5; });
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
console.log('online:', await st(() => ({ state: window.__jpkart.state, field: window.__jpkart.onlineField, addr: window.__jpkart.onlineAddr })));
// ir al campo servidor y escribir localhost:PUERTO (campo 1; NO moverse al 2 o el texto cae en el código)
await page.evaluate(() => { window.__jpkart.onlineField = 1; window.__jpkart.onlineAddr = ''; window.__jpkart.onlineCode = ''; });
await page.waitForTimeout(200);
await page.keyboard.type('localhost:' + PORT, { delay: 20 });
await page.waitForTimeout(300);
console.log('antes de crear:', await st(() => ({ addr: window.__jpkart.onlineAddr, code: window.__jpkart.onlineCode, field: window.__jpkart.onlineField })));
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__jpkart.net?.status === 'lobby' && window.__jpkart.net.id > 0, null, { timeout: 15000 });
console.log('lobby:', await st(() => ({ room: window.__jpkart.net.room, host: window.__jpkart.net.isHost, players: window.__jpkart.net.players.length })));
// Enter = empezar (host solo: debe arrancar sin esperar)
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__jpkart.state === 'race', null, { timeout: 30000 });
console.log('RACE OK:', await st(() => ({ state: window.__jpkart.state, go: window.__jpkart.net.go, track: window.__jpkart.curTrack })));
await page.waitForTimeout(5000);
const t1 = await st(() => window.__jpkart.world.tick);
await page.waitForTimeout(1000);
const t2 = await st(() => window.__jpkart.world.tick);
console.log('mundo avanza:', t1, '->', t2, t2 > t1 ? 'OK' : 'FALLO');
console.log(JSON.stringify({ errors }));
await browser.close();
on.close();
const ok = !errors.length && t2 > t1;
console.log(ok ? 'OK' : 'FALLÓ');
process.exit(ok ? 0 : 1);
