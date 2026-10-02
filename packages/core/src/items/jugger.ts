// jugger: see docs/GDD.md §3.2
import { addFx, removeFx } from '../sim/effects';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'jugger', name: 'Blindaje de Juggernaut', w: 3, role: 'defensa', aiQuick: true,
  use(_w, k) { addFx(k, 'jug', T.items.jugger.time, k.id); removeFx(k, 'bubble'); },
});
