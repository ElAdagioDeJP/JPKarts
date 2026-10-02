// cadena: see docs/GDD.md §3.3 (light hit on the kart ahead, then jumps to up to 2 karts close to each other)
import { dhypot } from '../dmath';
import { ahead, emit, hit } from '../sim/helpers';
import { rivalAhead } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'cadena', name: 'Cadena de Rayos', w: 5, role: 'ataque', aiNotWhenFirst: true,
  use(w, k) {
    const C = T.items.cadena;
    let cur = ahead(w, k);
    if (!cur) { emit(w, { type: 'alreadyFirst', kart: k.id }); return false; }
    const done = new Set<number>([k.id]);
    let from = k.id;
    for (let hop = 0; hop <= C.hops && cur; hop++) {
      done.add(cur.id);
      emit(w, { type: 'zap', from, to: cur.id });
      hit(w, cur, C.hit, 0, k.id);
      from = cur.id;
      const c: typeof cur = cur;
      let next: typeof cur | undefined, bd = C.range;
      for (const o of w.karts) { const d = dhypot(o.x - c.x, o.y - c.y); if (!done.has(o.id) && !o.finished && d < bd) { bd = d; next = o; } }
      cur = next;
    }
  },
  aiScore(w, k) {
    const a = rivalAhead(w, k, 400);
    if (!a) return k.rank > 0 ? 0.4 + k.hold * 0.03 : 0;
    let group = 0;
    for (const o of w.karts) if (o !== a[0] && o !== k && dhypot(o.x - a[0].x, o.y - a[0].y) < T.items.cadena.range) group++;
    return Math.min(1, 0.5 + group * 0.25);
  },
});
