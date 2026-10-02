// Contrarreloj (GDD §5): one kart, 10 coins and a Turbo Triple from the start, no coins or boxes on the track.
// Ghosts are replays of the record (seed + inputs), so the mode itself needs nothing else.
import { T } from '../tunables';
import { giveItem } from '../sim/items';
import { defineMode, watchedFinished } from '../sim/modes';

defineMode({
  id: 'timetrial', name: 'Contrarreloj', trackCoins: false, itemBoxes: false,
  setup(w) {
    for (const k of w.karts) { k.coins = T.race.timeTrial.coins; giveItem(w, k, T.race.timeTrial.item); }
  },
  endCondition: watchedFinished,
});
