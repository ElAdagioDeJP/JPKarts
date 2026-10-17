// antivirus: see docs/MECHANICS_BACKLOG.md #66 (cleans the control/slow debuffs on you and blocks new ones for a few seconds)
import { addFx, effectDef, removeFx } from '../sim/effects';
import { threatBehind } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';
import type { Kart } from '../sim/types';

const debuffed = (k: Kart) => k.fx.some((f) => { const t = effectDef(f.type)?.tags; return t?.includes('control') || t?.includes('slow'); });

defineItem({
  id: 'antivirus', name: 'Antivirus', w: 14, role: 'defensa',
  use(_w, k) {
    for (const f of [...k.fx]) {
      const t = effectDef(f.type)?.tags;
      if (t?.includes('control') || t?.includes('slow')) removeFx(k, f.type);
    }
    addFx(k, 'av', T.items.antivirus.time, k.id);
  },
  aiScore(_w, k) { return debuffed(k) ? 0.95 : Math.max(threatBehind(_w, k) * 0.6, k.hold > 8 ? 0.5 : 0); },
});
