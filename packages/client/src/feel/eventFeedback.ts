// Core → feedback bridge: game events become sound, banners, shake and flashes.
// Core never touches audio/render; all side effects live here.
// Add a new event case here + its sound/feel, no changes to Game needed beyond delegation.
import { CHARS, clamp, modeOf } from '@jpkart/core';
import type { GameEvent, Kart, World } from '@jpkart/core';
import { HAZARD_WARN } from '../app/types';
import type { Game } from '../game';

export function itemSound(g: Game, id: string, me: boolean, near: boolean, targetMe: boolean, ok: boolean) {
  const A = g.audio;
  switch (id) {
    case 'bocina': if (me || near) { A.beep(330, 0.4, 'sawtooth', 0.07); A.beep(415, 0.4, 'sawtooth', 0.05); } break;
    case 'falsa': if (me) A.beep(200, 0.1, 'triangle', 0.05); break;
    case 'turbo3': if (me) A.beep(300, 0.3, 'sawtooth', 0.05, 600); break;
    case 'ciego3': if (me) A.beep(700, 0.1, 'square', 0.05, -300); break;
    case 'bumeran': case 'bumeranR': if (me) A.beep(520, 0.25, 'triangle', 0.05, 260); break;
    case 'iman': if (me) A.beep(440, 0.4, 'sine', 0.05, 440); break;
    case 'cadena': if (me) A.beep(1600, 0.2, 'sawtooth', 0.05, -1200); break;
    case 'hielo': if (me) A.beep(1400, 0.15, 'sine', 0.04, -300); break;
    case 'humo': if (me) A.beep(150, 0.4, 'triangle', 0.05, -60); break;
    case 'rafaga': break;
    case 'bala': if (ok) A.beep(220, 0.6, 'sawtooth', 0.07, 900); break;
    case 'goma': if (me) A.beep(500, 0.15, 'sine', 0.05, -200); break;
    case 'ciego': if (me) A.beep(700, 0.1, 'square', 0.05, -300); break;
    case 'burbuja': if (me) A.beep(900, 0.2, 'sine', 0.05, 300); break;
    case 'nitro': if (me) A.beep(300, 0.35, 'sawtooth', 0.05, 600); break;
    case 'alquitran': if (me) A.beep(120, 0.25, 'triangle', 0.06, -40); break;
    case 'dron': if (me || targetMe) A.beep(880, 0.3, 'square', 0.04, -300); break;
    case 'gancho': if (ok && (me || targetMe)) A.beep(250, 0.4, 'sawtooth', 0.05, 400); break;
    case 'inversor': A.beep(600, 0.4, 'square', 0.05, -400); break;
    case 'pem': A.beep(90, 0.6, 'sawtooth', 0.08, 300); break;
    case 'jugger': if (me) A.beep(200, 0.5, 'square', 0.06, 300); break;
    case 'agujero': A.beep(60, 0.8, 'sawtooth', 0.08, -20); break;
    case 'cuantico': if (ok) A.beep(1200, 0.25, 'sine', 0.05, -800); break;
  }
}

/** Is the local kart within `frac` of a lap before track position `at` (0..1)? */
export function nearSample(g: Game, at: number, frac: number) {
  const p = g.local!, N = g.tr.N, i = Math.floor(at * N);
  const d = (i - p.idx + N) % N;
  return d < frac * N;
}

export function onEvent(g: Game, e: GameEvent) {
  const A = g.audio, w = g.world!, me = (id: number) => id === g.localId;
  const p = g.local;
  const near = (id: number, r: number) => { const k = w.karts[id]; return !!(p && k && Math.hypot(p.x - k.x, p.y - k.y) < r); };
  switch (e.type) {
    case 'countdown': A.beep(440, 0.12); break;
    case 'go': g.banner = { t: '¡Ya!', life: 0.9, big: true }; A.beep(880, 0.3); break;
    case 'flight': if (me(e.kart)) { g.banner = { t: '¡A volar!', life: 1 }; A.beep(400, 0.5, 'sine', 0.05, 500); } break;
    case 'fall': if (me(e.kart)) { g.banner = { t: g.tr.def.liquid?.msg ?? '¡Ay!', life: 1.2 }; A.groan(CHARS[w.karts[e.kart]!.ch]!, 0.45, Math.random()); } break;
    case 'shieldPop': if (me(e.kart)) { A.beep(1200, e.offroad ? 0.12 : 0.15, 'square', 0.05, -600); if (e.offroad) g.banner = { t: '¡La burbuja explotó!', life: 1 }; } break;
    case 'driftStart': if (me(e.kart)) A.beep(260, 0.06, 'square', 0.04); break;
    case 'miniTurbo': if (me(e.kart)) { if (e.level === 2) A.beep(520, 0.3, 'sawtooth', 0.06, 500); else A.beep(420, 0.2, 'sawtooth', 0.05, 300); } break;
    case 'jump': if (me(e.kart)) A.beep(330, 0.12, 'square', 0.04, 200); break;
    case 'land': if (me(e.kart) && e.hard) { A.beep(90, 0.1, 'square', 0.05); g.rig.addTrauma(0.2); } break;
    case 'pad': if (me(e.kart)) A.beep(640, 0.2, 'sawtooth', 0.05, 500); break;
    case 'itemRoll': if (me(e.kart)) { A.beep(1100, 0.05, 'square', 0.05); A.beep(600, 0.08, 'square', 0.04, 300); } break;
    case 'itemGet': if (me(e.kart)) A.beep(880, 0.08); break;
    case 'itemUse': itemSound(g, e.item, me(e.kart), near(e.kart, 260), e.target != null && me(e.target), e.ok); break;
    case 'alreadyFirst': if (me(e.kart)) g.banner = { t: 'Ya vas primero', life: 1 }; break;
    case 'hit': {
      const k = w.karts[e.kart]!, d = p ? Math.hypot(p.x - k.x, p.y - k.y) : 0;
      if (me(e.kart)) { g.rig.addTrauma(0.55); g.hitStop = 0.06; g.held = w.karts.map((q) => g.pose(q)); A.duck(0.4); }
      else if (d < 80) g.rig.addTrauma(0.15);
      A.groan(CHARS[k.ch]!, me(e.kart) ? 0.5 : 0.45 * (1 - clamp(d / 380, 0, 1)), Math.random());
      break;
    }
    case 'bump': if (me(e.a) || me(e.b)) { A.beep(120, 0.06, 'square', 0.04); g.rig.addTrauma(0.08); } break;
    case 'coin': if (me(e.kart)) A.beep(1320 + e.coins * 40, 0.06, 'square', 0.035, 200); break;
    case 'coinLoss': if (me(e.kart)) { g.coinPop = 1; A.beep(900, 0.18, 'square', 0.04, -500); } break;
    case 'zap': { if (me(e.to)) { g.flashC = '#3df0ff'; g.flashT = 0.2; } if (me(e.from) || me(e.to) || near(e.to, 220)) A.beep(1800, 0.12, 'sawtooth', 0.05, -1500); break; }
    case 'gust': if (me(e.kart) || near(e.kart, 160)) A.beep(200, 0.45, 'triangle', 0.05, 300); break;
    case 'catch': if (me(e.kart)) { g.banner = { t: '¡Atrapado!', life: 0.8 }; A.beep(760, 0.12, 'square', 0.05, 300); } break;
    case 'lap': if (me(e.kart) && !modeOf(w).arena) { if (e.final) A.duck(0.8); g.banner = { t: e.final ? '¡Última vuelta!' : 'Vuelta ' + e.lap, life: 1.8 }; A.beep(e.final ? 990 : 700, 0.2); } break;
    case 'finish': if (me(e.kart)) { A.duck(1.2); g.banner = { t: '¡Meta!', life: 2.2, big: true }; A.musicWant(null); A.jingle(); } break;
    case 'flash': g.flashC = e.color; g.flashT = 0.35; break;
    case 'driftLevel': if (me(e.kart)) A.beep(e.level === 3 ? 760 : e.level === 2 ? 620 : 500, 0.07, 'square', 0.04, 120); break;
    case 'trick': if (me(e.kart)) { g.banner = { t: '¡Truco!', life: 0.7 }; A.beep(980, 0.12, 'square', 0.05, 400); } break;
    case 'slipstream': if (me(e.kart)) { g.banner = { t: '¡Rebufo!', life: 0.6 }; A.beep(360, 0.3, 'sawtooth', 0.04, 500); } break;
    case 'wallBump': if (me(e.kart)) { A.beep(e.hard ? 90 : 140, 0.08, 'square', 0.05); g.rig.addTrauma(e.hard ? 0.35 : 0.12); } break;
    case 'burnout': if (me(e.kart)) { g.banner = { t: '¡Quemaste rueda!', life: 1 }; A.beep(110, 0.5, 'sawtooth', 0.05, -40); } break;
    case 'rocketStart': if (me(e.kart)) { g.banner = { t: '¡Turbo de salida!', life: 0.9 }; A.beep(300, 0.35, 'sawtooth', 0.05, 600); } break;
    case 'incoming': if (me(e.kart)) { g.incoming = { item: e.item, t: Math.max(1, e.eta) }; A.beep(1400, 0.08, 'square', 0.05); A.beep(1400, 0.08, 'square', 0.05); } break;
    case 'hazardWarn': if (g.local && nearSample(g, e.at, 0.12)) { const msg = HAZARD_WARN[e.kind]; if (msg) g.banner = { t: msg, life: 1 }; A.beep(220, 0.6, 'triangle', 0.05, 200); } break;
    case 'tide': g.banner = { t: '¡Sube la marea!', life: 1.6 }; A.beep(180, 0.9, 'sine', 0.06, -60); break;
    case 'reflect': A.beep(1600, 0.15, 'sine', 0.05, -900); break;
    case 'explode': { const p0 = g.local; if (p0 && Math.hypot(p0.x - e.x, p0.y - e.y) < 260) { A.beep(70, 0.4, 'sawtooth', 0.08, -30); g.flashC = '#ff8a1f'; g.flashT = 0.2; g.rig.addTrauma(0.5 * (1 - Math.hypot(p0.x - e.x, p0.y - e.y) / 260)); } break; }
    case 'raceEnd':
      if (g.state === 'race') g.state = 'results';
      if (g.recorder) { g.lastReplay = g.recorder.replay; g.recorder = null; }
      g.onRaceEnd();
      break;
    case 'balloon': if (me(e.kart)) { g.banner = { t: e.left ? 'Te quedan ' + e.left + ' globo' + (e.left > 1 ? 's' : '') : '¡Sin globos!', life: 1.2 }; A.beep(1500, 0.08, 'square', 0.05, -900); } else if (me(e.by)) { g.banner = { t: '¡Globo!', life: 0.7 }; A.beep(900, 0.1, 'square', 0.05, 400); } break;
    case 'balloonSteal': if (me(e.kart)) { g.banner = { t: '¡Globo robado!', life: 1 }; A.beep(700, 0.2, 'square', 0.05, 500); } else if (me(e.from)) { g.banner = { t: '¡Te robaron un globo!', life: 1 }; A.beep(300, 0.2, 'square', 0.05, -200); } break;
    case 'flagGet': if (me(e.kart)) { g.banner = { t: '¡Tienes la bandera!', life: 1.2 }; A.beep(880, 0.25, 'square', 0.05, 400); } else if (near(e.kart, 300)) A.beep(440, 0.12, 'square', 0.04); break;
    case 'flagDrop': if (me(e.kart)) { g.banner = { t: '¡Perdiste la bandera!', life: 1.2 }; A.beep(220, 0.3, 'sawtooth', 0.05, -100); } break;
    case 'eliminated': if (me(e.kart)) { g.banner = { t: '¡Eliminado!', life: 2, big: true }; A.beep(160, 0.6, 'sawtooth', 0.07, -80); } else { g.banner = { t: 'Fuera: ' + CHARS[w.karts[e.kart]!.ch]!.short + ' · quedan ' + e.left, life: 1.6 }; A.beep(520, 0.15, 'square', 0.05, -200); } break;
  }
}

/** Positional rival engines + adaptive music intensity. */
export function audioFrame(g: Game, w: World, p: Kart) {
  const near = w.karts.filter((k) => k !== p && k.respawn <= 0).map((k) => {
    const dx = k.x - p.x, dy = k.y - p.y, dist = Math.hypot(dx, dy);
    return { dist, pan: Math.sin(Math.atan2(dy, dx) - g.cam.a), speed: k.speed };
  }).sort((a, b) => a.dist - b.dist).slice(0, 3);
  g.audio.rivalEngines(near);
  const crowd = near.filter((r) => r.dist < 120).length / 3;
  const lastLap = p.prog >= (w.cfg.laps - 1) * g.tr.N ? 0.35 : 0;
  g.audio.intensity = Math.min(1, 0.25 + crowd * 0.4 + lastLap + (p.rank === 0 ? 0.1 : 0) + (p.boost > 0 ? 0.1 : 0));
}
