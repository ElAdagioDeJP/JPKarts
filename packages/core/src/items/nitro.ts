// nitro: see docs/GDD.md §3.2
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'nitro', name: 'Inyector Nitro Básico', w: 30, role: 'movilidad',
  use(_w, k) { k.boost = Math.max(k.boost, T.items.nitro.boost); },
});
