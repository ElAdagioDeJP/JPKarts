// Quality tier mid-race check (online guest). Every key used to re-apply the settings, and applying a tier disposed
// the shadow map: pressing the throttle during the countdown left WebGPU submitting a destroyed ShadowDepthTexture and
// the 3D view froze on the starting grid while the HUD kept going. Default: the guest also drops to 'ahorro' as the
// race starts (what a slow PC does by itself: < 40 fps for 3 s while the track and the 12 karts compile).
// The 3D view must keep drawing, with no WebGPU errors, and the guest's kart must move on the server.
// Usage: bun tools/tier-check.mjs [--late | --keys-only] [--headed]   (needs `bun run dev` on :5173)
import { chromium } from 'playwright';
import { startOnlineServer } from '../packages/server/src/online.ts';

const PORT = 7791, on = startOnlineServer(PORT, () => {});
const headless = !process.argv.includes('--headed'), late = process.argv.includes('--late'), keysOnly = process.argv.includes('--keys-only');
let browser;
try { browser = await chromium.launch({ headless, channel: 'msedge', args: ['--enable-unsafe-webgpu'] }); } catch { browser = await chromium.launch({ headless }); }
const errors = [];
let code = '';
async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ' console: ' + m.text()); });
  await page.goto('http://localhost:5173/');
  await page.waitForFunction(() => !!window.__jpkart, null, { timeout: 30000, polling: 500 });
  await page.evaluate(() => { window.__jpkart.renderer.noteFps = () => false; }); // the downgrade happens when this script says
  await page.evaluate(([n, a, c]) => { const g = window.__jpkart; g.state = 'menu'; g.lanName = n; g.profile = { ...g.profile, id: 'pid-' + n + '-0000001', name: n, tutorialDone: true }; g.connectLan(a, n, c ? { room: c } : { create: true }); }, [name, 'localhost:' + PORT, code]);
  await page.waitForFunction(() => window.__jpkart.net?.status === 'lobby' && window.__jpkart.net.id > 0, null, { timeout: 15000 });
  if (!code) code = await page.evaluate(() => window.__jpkart.net.room);
  return page;
}
// polls from node: page-side waitForFunction uses rAF/timers that background tabs throttle
const until = async (p, fn, ms = 30000) => { const t = Date.now(); while (!(await p.evaluate(fn))) { if (Date.now() - t > ms) throw new Error('timeout: ' + fn); await new Promise((r) => setTimeout(r, 300)); } };
const host = await player('Juan');
const guest = await player('Diego');
await guest.keyboard.press('ArrowRight'); await guest.waitForTimeout(200); await guest.keyboard.press('KeyR'); await guest.waitForTimeout(500);
if (!late && !keysOnly) await guest.evaluate(() => { const g = window.__jpkart; const iv = setInterval(() => { if (g.state === 'race') { clearInterval(iv); g.renderer.applyTier('ahorro'); } }, 0); });
await host.keyboard.press('Enter');
for (const p of [host, guest]) await until(p, () => window.__jpkart.state === 'race', 60000);
const room = [...on.rooms.values()][0];
await guest.bringToFront();
// keys during the countdown (every key used to re-apply the settings and with them the quality tier)
while (!(await guest.evaluate(() => window.__jpkart.world.phase === 'race'))) { await guest.keyboard.press('ArrowUp'); await guest.waitForTimeout(250); }
if (late && !keysOnly) await guest.evaluate(() => window.__jpkart.renderer.applyTier('ahorro'));
await guest.keyboard.down('ArrowUp');
const kart = await guest.evaluate(() => window.__jpkart.net.race.kart), p0 = room.world.karts[kart].prog;
const crop = { x: 200, y: 150, width: 560, height: 300 };
const a1 = await guest.screenshot({ clip: crop }); await guest.waitForTimeout(1500); const a2 = await guest.screenshot({ clip: crop });
const tier = await guest.evaluate(() => window.__jpkart.renderer.tier), moved = room.world.karts[kart].prog - p0;
console.log(JSON.stringify({ tier, drawing: !a1.equals(a2), moved: +moved.toFixed(1), errors: errors.slice(0, 5) }));
const ok = tier === (keysOnly ? 'alta' : 'ahorro') && !a1.equals(a2) && moved > 10 && !errors.length;
await browser.close(); on.close();
console.log(ok ? 'OK' : 'FALLÓ');
process.exit(ok ? 0 : 1);
