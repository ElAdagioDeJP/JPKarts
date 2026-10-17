// overclock: see docs/MECHANICS_BACKLOG.md #64 (sustained top-speed boost; the effect lives in sim/effectDefs.ts)
import { rankRel, straightAhead } from '../ai/ai';
import { addFx } from '../sim/effects';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'overclock', name: 'Overclock', w: 22, role: 'movilidad',
  use(_w, k) { addFx(k, 'oc', T.items.overclock.time, k.id); },
  aiScore(w, k) { return straightAhead(w, k, 30) * 0.9 + rankRel(w, k) * 0.2; },
});
