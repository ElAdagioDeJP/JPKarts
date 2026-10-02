// burbuja: see docs/GDD.md §3.2
import { addFx } from '../sim/effects';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'burbuja', name: 'Escudo de Burbuja', w: 40, role: 'defensa', aiQuick: true,
  use(_w, k) { addFx(k, 'bubble', 1, k.id); },
});
