// Developer-themed pixel art (NexTec.plus): item boxes, the fake box and the scenery that used to be balls, cows and barns.
// Same dimensions as the sprites they replace, so the tracks (which name them in JSON) do not change.
import { OUT, P, cyl, mk, shade, sph, type Spr } from './pixel';

const DARK = '#3a3848', STEEL = '#9aa0b4', PAPER = '#d8dce8', KEY = '#5a6078';
const MINT = '#5de6c8', GOLD = '#ffd54a', PINK = '#ff6a9a', NIGHT = '#1b1740';
const LEDS = [MINT, GOLD, '#e8455a'];

/** Four frames the item box cycles through: keyboard, mouse, laptop with code, mug of Java. */
const keyboard = () => mk(16, 16, (p) => {
  P.rect(p, 0, 4, 16, 10, DARK);
  P.rect(p, 1, 5, 14, 8, PAPER);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) P.set(p, 2 + c * 2, 6 + r * 2, c === 5 && r === 0 ? MINT : KEY);
  P.rect(p, 4, 12, 8, 1, KEY);
});
const mouse = () => mk(16, 16, (p) => {
  P.line(p, 8, 4, 8, 0, DARK, 1);
  P.ell(p, 8, 9, 5, 6.5, sph('#e8ecf8'));
  P.rect(p, 8, 4, 1, 5, KEY);
  P.rect(p, 7, 5, 2, 3, MINT);
});
const laptop = () => mk(16, 16, (p) => {
  P.rect(p, 2, 1, 12, 9, DARK);
  P.rect(p, 3, 2, 10, 7, NIGHT);
  P.rect(p, 4, 3, 5, 1, MINT); P.rect(p, 5, 5, 7, 1, GOLD); P.rect(p, 4, 7, 3, 1, PINK);
  P.rect(p, 0, 11, 16, 3, STEEL);
  P.rect(p, 5, 12, 6, 1, KEY);
});
const coffee = () => mk(16, 16, (p) => {
  P.ell(p, 13, 9, 2.6, 3, (dx, dy) => (dx * dx + dy * dy > 0.45 ? '#f4ecd8' : 0));
  P.rect(p, 2, 6, 9, 9, cyl('#f4ecd8'));
  P.rect(p, 3, 9, 7, 2, '#e8455a');
  for (const x of [4, 7]) P.line(p, x, 4, x + 1, 1, '#ffffff', 1);
});
export const BALLS: Spr[] = [keyboard(), mouse(), laptop(), coffee()];

/** Fake box: a blue-screen-of-death monitor with an angry face. */
export const FAKEBOX = mk(16, 16, (p) => {
  P.rect(p, 0, 1, 16, 11, DARK);
  P.rect(p, 1, 2, 14, 9, '#1f5fe0');
  P.rect(p, 4, 4, 2, 2, '#ffffff'); P.rect(p, 10, 4, 2, 2, '#ffffff');
  P.line(p, 3, 3, 6, 4, OUT, 1); P.line(p, 13, 3, 10, 4, OUT, 1);
  P.line(p, 5, 9, 11, 9, '#ffffff', 1);
  P.rect(p, 6, 12, 4, 2, STEEL); P.rect(p, 3, 14, 10, 2, STEEL);
});

/** Big disc (stadium/beach decoration before): a CD with a rainbow sheen. */
export const BIGBALL = mk(28, 28, (p) => {
  const rainbow = [PINK, GOLD, MINT, '#6aa0ff'];
  P.ell(p, 14, 14, 13, 13, (dx, dy) => {
    const d = Math.hypot(dx, dy);
    if (d < 0.12) return 0;
    if (d < 0.32) return PAPER;
    return rainbow[(((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 2)) | 0) % 4]!;
  });
  P.ell(p, 10, 9, 3, 3, (_dx, dy) => (dy < 0 ? '#ffffff' : 0));
});

/** Scenery that replaces the farm/beach props (same keys in `D`). */
export const DEV_DECOR: Record<string, Spr> = {
  // cow -> computer mouse
  cow: mk(18, 13, (p) => {
    P.line(p, 9, 3, 15, 0, DARK, 1);
    P.ell(p, 9, 8, 7, 4.5, sph('#e8ecf8'));
    P.rect(p, 9, 4, 1, 4, KEY);
    P.rect(p, 8, 5, 2, 3, MINT);
  }),
  // barn -> data center
  barn: mk(34, 26, (p) => {
    P.rect(p, 0, 3, 34, 4, STEEL);
    P.rect(p, 2, 7, 30, 19, (i) => (i < 3 ? '#4a4a64' : i > 26 ? '#2a2840' : '#3a3a54'));
    for (let y = 10; y <= 18; y += 4) for (let x = 5; x <= 27; x += 5) P.rect(p, x, y, 3, 2, LEDS[((x / 5) + y / 4) % 3 | 0]!);
    P.rect(p, 13, 19, 8, 7, NIGHT);
    P.rect(p, 16, 20, 2, 5, MINT);
  }),
  // umbrella -> monitor with code
  umbrella: mk(22, 22, (p) => {
    P.rect(p, 1, 1, 20, 14, DARK);
    P.rect(p, 2, 2, 18, 12, NIGHT);
    P.rect(p, 4, 4, 8, 1, MINT); P.rect(p, 6, 6, 10, 1, GOLD); P.rect(p, 6, 8, 5, 1, PINK); P.rect(p, 4, 10, 12, 1, '#6aa0ff');
    P.rect(p, 9, 15, 4, 4, STEEL);
    P.rect(p, 5, 19, 12, 2, STEEL);
  }),
  // surf -> upright keyboard
  surf: mk(8, 22, (p) => {
    P.rect(p, 0, 0, 8, 22, (i) => (i === 0 ? '#f4f6ff' : PAPER));
    for (let y = 2; y <= 17; y += 3) { P.rect(p, 1, y, 2, 2, KEY); P.rect(p, 5, y, 2, 2, y === 2 ? MINT : KEY); }
    P.rect(p, 2, 20, 4, 1, KEY);
  }),
  // camel -> open laptop
  camel: mk(22, 18, (p) => {
    P.rect(p, 3, 1, 16, 10, DARK);
    P.rect(p, 4, 2, 14, 8, NIGHT);
    P.rect(p, 5, 3, 6, 1, MINT); P.rect(p, 7, 5, 8, 1, GOLD); P.rect(p, 5, 7, 4, 1, PINK);
    P.rect(p, 0, 12, 22, 4, STEEL);
    P.rect(p, 8, 13, 6, 1, KEY);
  }),
  // lighthouse -> antenna tower with dish
  lighthouse: mk(16, 50, (p) => {
    P.rect(p, 7, 6, 2, 44, (i) => (i === 0 ? '#c8ccd8' : STEEL));
    for (const y of [16, 26, 36]) { P.line(p, 8, y, 3, y + 10, STEEL, 1); P.line(p, 8, y, 13, y + 10, STEEL, 1); }
    P.ell(p, 8, 7, 7, 3.4, (dx, dy) => (dy > 0.1 ? shade('#f4f6ff', 0.75) : '#f4f6ff'));
    P.ell(p, 8, 2, 2, 2, '#ff3a3a');
    P.rect(p, 3, 46, 10, 4, DARK);
  }),
  // buoy -> USB stick
  buoy: mk(8, 16, (p) => {
    P.rect(p, 2, 0, 4, 6, STEEL);
    P.set(p, 3, 2, DARK); P.set(p, 4, 2, DARK);
    P.rect(p, 1, 6, 6, 10, '#3a3448');
    P.set(p, 4, 12, MINT);
  }),
};
