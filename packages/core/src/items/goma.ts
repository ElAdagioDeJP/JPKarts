// goma: see docs/GDD.md §3.2
import { addFx } from '../sim/effects';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'goma', name: 'Parachoques de Goma', w: 70, role: 'defensa', aiQuick: true,
  use(_w, k) { addFx(k, 'goma', T.items.goma.time, k.id); },
});
