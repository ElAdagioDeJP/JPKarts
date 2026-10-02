// Item balance telemetry (docs/PLAN.md Fase 8): AI-only races on the authored tracks. Per position: items
// received and used, hits taken, coins. Per item: who gets it (front 1–2, middle 3–5, back 6–8) and how often it
// is used. Usage: bun packages/core/tools/item-telemetry.ts [racesPerTrack=2] [diff=1]
import { AUTHORED, ALL_TRACKS, LAPS, Rng, TrackCache, buildGrid, createWorld, itemDef, itemList, prepAuthored, step, takeEvents } from '../src';

const per = Number(process.argv[2] ?? 2), diff = Number(process.argv[3] ?? 1);
const cache = new TrackCache(ALL_TRACKS, prepAuthored);
const N = 8, bucket = (r: number) => (r < 2 ? 0 : r < 5 ? 1 : 2);
const got = Array.from({ length: N }, () => 0), used = Array.from({ length: N }, () => 0), hits = Array.from({ length: N }, () => 0), coins = Array.from({ length: N }, () => 0);
const byItem = new Map<string, { got: [number, number, number]; used: number }>();
for (const it of itemList()) byItem.set(it.id, { got: [0, 0, 0], used: 0 });
let races = 0;
for (const a of AUTHORED) {
  const ti = ALL_TRACKS.findIndex((t) => t.id === a.id), tr = cache.ensureBuilt(ti);
  for (let r = 0; r < per; r++) {
    const seed = 500 + r * 31 + ti;
    const w = createWorld({ trackIndex: ti, diff, seed, laps: LAPS, grid: buildGrid(new Rng(seed), [], { humanSlot: 0 }) }, tr);
    for (let t = 0; t < 60 * 60 * 6 && w.phase !== 'results'; t++) {
      step(w, []);
      for (const e of takeEvents(w)) {
        if (e.type === 'itemGet') { const k = w.karts[e.kart]!; got[k.rank]!++; byItem.get(e.item)!.got[bucket(k.rank)]!++; }
        if (e.type === 'itemUse' && e.ok) { const k = w.karts[e.kart]!; used[k.rank]!++; byItem.get(e.item)!.used++; }
        if (e.type === 'hit') hits[w.karts[e.kart]!.rank]!++;
      }
    }
    for (const k of w.karts) coins[w.finalOrder.indexOf(k.id)]! += k.coins;
    races++;
  }
}
const f = (x: number) => (x / races).toFixed(1).padStart(5);
console.log(`${races} carreras de 8 IA (${['Fácil', 'Normal', 'Difícil'][diff]}) en ${AUTHORED.length} pistas\n`);
console.log('Puesto   objetos  usados  golpes  monedas al final  (por carrera)');
for (let i = 0; i < N; i++) console.log(`  ${i + 1}º    ${f(got[i]!)}   ${f(used[i]!)}   ${f(hits[i]!)}   ${f(coins[i]!)}`);
console.log('\nObjeto                       delante  medio  detrás   usados');
for (const it of itemList()) {
  const b = byItem.get(it.id)!, tot = b.got[0] + b.got[1] + b.got[2];
  if (!tot && it.noRoll) continue;
  const pct = (x: number) => (tot ? ((x / tot) * 100).toFixed(0) + '%' : '-').padStart(6);
  console.log(`${itemDef(it.id).name.padEnd(28)} ${pct(b.got[0])} ${pct(b.got[1])} ${pct(b.got[2])}   ${String(b.used).padStart(4)}/${tot}`);
}
