// jugger: see docs/GDD.md §3
import { addFx, removeFx } from '../sim/effects';
import { straightAhead, threatBehind } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'jugger', name: 'Blindaje de Juggernaut', w: 3, role: 'defensa',
  use(_w, k) { addFx(k, 'jug', T.items.jugger.time, k.id); removeFx(k, 'bubble'); },
  aiScore(w, k) { return 0.5 + straightAhead(w, k, 30) * 0.3 + threatBehind(w, k) * 0.4; },
});
