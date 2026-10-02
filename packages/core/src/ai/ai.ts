// AI: navigation (racing line + speed profile), tactics (utility AI at 5 Hz) and items (aiScore).
// Deterministic: all randomness comes from the race RNG; debug info is write-only (never read back).
import { CHARS } from '../data/characters';
import { datan2, dcos, dhypot, dsin } from '../dmath';
import { clamp, wrapA } from '../math';
import { T } from '../tunables';
import { lateralAt, type Track } from '../track/track';
import { cornerSpeed, targetSpeed, type RacingLine } from './line';
import { entityDef } from '../sim/entities';
import { itemDef, useItem } from '../sim/items';
import type { Input, Kart, World } from '../sim/types';

export type AiAct = 'linea' | 'adelantar' | 'bloquear' | 'esquivar' | 'rebufo';
export interface AiState {
  act: AiAct;
  /** extra lateral offset over the racing line */
  tOff: number;
  /** lateral noise (line precision) */
  noise: number;
  /** chosen shortcut index, -1 = main road */
  branch: number;
  /** last shortcut entry we decided about */
  decided: number;
  /** seconds left of a simulated mistake */
  mistake: number;
  /** base speed multiplier of this AI (difficulty) */
  speed: number;
  /** difficulty index of this AI (defaults to the race difficulty) */
  diff: number;
}

export interface AiDebug { act: AiAct; scores: Record<string, number>; tx: number; ty: number; vt: number; item: number }
/** Debug only (F4 overlay). Written by the AI, never read by the simulation. */
export const aiDebug = new Map<number, AiDebug>();

/** Difficulty parameters of a kart's AI (or the race's when no kart is given). */
export const aiDiff = (w: World, k?: Kart) => T.ai.difficulty[k?.ai?.diff ?? w.cfg.diff]!;
const persona = (k: Kart) => T.ai.personality[CHARS[k.ch]!.personality];
const yawRate = (k: Kart) => T.driving.steer.rate * CHARS[k.ch]!.hnd * 0.92;

export function newAiState(w: World, diff = w.cfg.diff): AiState {
  const D = T.ai.difficulty[diff]!;
  return { act: 'linea', tOff: 0, noise: 0, branch: -1, decided: -1, mistake: 0, speed: w.rng.range(D.speed[0]!, D.speed[1]!), diff };
}

/** Signed distance along the track from a to b (samples), in (-N/2, N/2]. */
function along(tr: Track, a: number, b: number) {
  let d = b - a;
  if (d > tr.N / 2) d -= tr.N;
  if (d <= -tr.N / 2) d += tr.N;
  return d;
}

// ---------------- considerations (all return 0..1) ----------------
/** Nearest rival ahead on the track within `range` units: [kart, distance] */
export function rivalAhead(w: World, k: Kart, range: number): [Kart, number] | null {
  let best: Kart | null = null, bd = range;
  for (const o of w.karts) {
    if (o === k || o.respawn > 0) continue;
    const d = along(w.track, k.idx, o.idx) * 6;
    if (d > 0 && d < bd) { bd = d; best = o; }
  }
  return best ? [best, bd] : null;
}
export function rivalBehind(w: World, k: Kart, range: number): [Kart, number] | null {
  let best: Kart | null = null, bd = range;
  for (const o of w.karts) {
    if (o === k || o.respawn > 0) continue;
    const d = -along(w.track, k.idx, o.idx) * 6;
    if (d > 0 && d < bd) { bd = d; best = o; }
  }
  return best ? [best, bd] : null;
}
/** A rival lined up in front (for straight shots). */
export function aimed(w: World, k: Kart, range: number, cone: number): number {
  for (const o of w.karts) {
    if (o === k) continue;
    const dx = o.x - k.x, dy = o.y - k.y, d = dhypot(dx, dy);
    if (d < range && d > 20 && Math.abs(wrapA(datan2(dy, dx) - k.a)) < cone) return 1 - d / range;
  }
  return 0;
}
/** How straight the next stretch is (1 = straight). */
export function straightAhead(w: World, k: Kart, samples = 40): number {
  const line = w.track.line!;
  let m = 0;
  for (let j = 0; j < samples; j += 2) m = Math.max(m, line.kappa[(k.idx + j) % w.track.N]!);
  return clamp(1 - m * 60, 0, 1);
}
/** A threat coming from behind (projectile entity or rival very close). */
export function threatBehind(w: World, k: Kart): number {
  for (const e of w.ents) {
    if (e.owner === k.id) continue;
    if ((e.kind === 'rocket' && e.target === k.id) || e.kind === 'shot') {
      const d = dhypot(e.x - k.x, e.y - k.y);
      if (d < 200) return 1 - d / 200;
    }
  }
  const b = rivalBehind(w, k, 40);
  return b ? 0.5 * (1 - b[1] / 40) : 0;
}
export const rankRel = (w: World, k: Kart) => (w.karts.length > 1 ? k.rank / (w.karts.length - 1) : 0);

// ---------------- tactics ----------------
function think(w: World, k: Kart, dbg: AiDebug) {
  const tr = w.track, line = tr.line!, A = T.ai, P = persona(k), D = aiDiff(w, k), s = k.ai!;
  const myLat = lateralAt(tr, k.idx, k.x, k.y), lineOff = line.off[k.idx]!;
  const scores: Record<AiAct, number> = { linea: 0.5, adelantar: 0, bloquear: 0, esquivar: 0, rebufo: 0 };
  const tOff: Record<AiAct, number> = { linea: 0, adelantar: 0, bloquear: 0, esquivar: 0, rebufo: 0 };
  const ah = rivalAhead(w, k, A.overtake.range * 2);
  if (ah) {
    const [o, d] = ah, oLat = lateralAt(tr, k.idx, o.x, o.y);
    if (d < A.overtake.range && o.speed <= k.speed + A.overtake.speedGap) {
      scores.adelantar = 0.65 * P.attack;
      const side = oLat > lineOff ? -1 : 1;
      tOff.adelantar = oLat + side * A.overtake.offset - lineOff;
    } else if (d < A.slip.range) {
      scores.rebufo = 0.55 * P.slip;
      tOff.rebufo = oLat - lineOff;
    }
  }
  const bh = rivalBehind(w, k, A.block.range);
  if (bh && k.rank < w.karts.length - 1) {
    scores.bloquear = 0.5 * P.block * (1 - bh[1] / A.block.range) + 0.1;
    tOff.bloquear = clamp(lateralAt(tr, k.idx, bh[0].x, bh[0].y) - lineOff, -A.block.maxOffset, A.block.maxOffset);
  }
  // avoid traps / hazards on our path
  for (const e of w.ents) {
    const def = entityDef(e.kind);
    if (!(def.zone || e.kind === 'mine' || e.kind === 'fake' || e.kind === 'ola')) continue;
    if (e.owner === k.id && e.kind !== 'ola') continue;
    const dx = e.x - k.x, dy = e.y - k.y, d = dhypot(dx, dy);
    if (d > A.avoid.range) continue;
    if (Math.abs(wrapA(datan2(dy, dx) - k.a)) > 0.6) continue;
    const eLat = lateralAt(tr, k.idx, e.x, e.y);
    scores.esquivar = Math.max(scores.esquivar, 0.95 * (1 - d / A.avoid.range) + 0.3);
    tOff.esquivar = eLat - lineOff + (eLat > myLat ? -A.avoid.offset : A.avoid.offset);
  }
  scores[s.act] += A.hysteresis;
  let best: AiAct = 'linea';
  for (const a of Object.keys(scores) as AiAct[]) if (scores[a] > scores[best]) best = a;
  s.act = best;
  s.tOff = tOff[best];
  s.noise = s.noise * 0.6 + w.rng.range(-D.lineNoise, D.lineNoise) * 0.4;
  // simulated mistakes: `mistakes` per ~55 s lap
  if (s.mistake <= 0 && w.rng.next() < D.mistakes / (55 * A.tacticsHz)) s.mistake = 0.5;
  // shortcuts: decide once when approaching the entry
  for (let bi = 0; bi < tr.branches.length; bi++) {
    const b = tr.branches[bi]!, d = along(tr, k.idx, b.i0);
    if (d > 0 && d < A.shortcut.decide && s.decided !== bi) {
      s.decided = bi;
      s.branch = w.rng.next() < D.shortcut * P.risk ? bi : -1;
    }
  }
  dbg.scores = scores;
}

/** Where on the chosen path to aim, `look` samples ahead. */
function aimPoint(w: World, k: Kart, look: number): [number, number] {
  const tr = w.track, line = tr.line!, s = k.ai!;
  if (s.branch >= 0) {
    const b = tr.branches[s.branch]!;
    // on or right before the shortcut: follow its points
    let bi = -1, bd = 1e9;
    for (let i = 0; i < b.n; i++) { const d = dhypot(b.x[i]! - k.x, b.y[i]! - k.y); if (d < bd) { bd = d; bi = i; } }
    const before = along(tr, k.idx, b.i0);
    if (bd < 60 || (before >= 0 && before < look)) {
      if (bi >= b.n - 3) s.branch = -1;
      else { const j = Math.min(b.n - 1, (bd < 60 ? bi : 0) + Math.max(3, look >> 1)); return [b.x[j]!, b.y[j]!]; }
    }
    if (bd > 400 && before < 0) s.branch = -1;
  }
  const i = (k.idx + look) % tr.N, off = clamp(line.off[i]! + s.tOff + s.noise, -tr.wd[i]! + 6, tr.wd[i]! - 6);
  return [tr.x[i]! - dsin(tr.ang[i]!) * off, tr.y[i]! + dcos(tr.ang[i]!) * off];
}

/** One tick of AI driving. */
export function aiInput(w: World, k: Kart): Input {
  const tr = w.track, line: RacingLine = tr.line!, A = T.ai, D = aiDiff(w, k), s = k.ai!;
  let dbg = aiDebug.get(k.id);
  if (!dbg) { dbg = { act: 'linea', scores: {}, tx: 0, ty: 0, vt: 0, item: 0 }; aiDebug.set(k.id, dbg); }
  if ((w.tick + k.id * 3) % Math.round(60 / A.tacticsHz) === 0) think(w, k, dbg);
  const L = A.line, look = Math.round(L.lookBase + Math.max(0, k.speed) / L.lookDiv);
  const [tx, ty] = aimPoint(w, k, look);
  let diffA = wrapA(datan2(ty - k.y, tx - k.x) - k.a);
  const yaw = yawRate(k);
  let vt = targetSpeed(tr, line, k.idx, yaw);
  if (k.drift) vt *= 1.12; // drifting turns tighter
  let t = k.speed > vt * 1.12 ? -1 : k.speed > vt ? 0 : 1;
  if (Math.abs(diffA) > 1.3) t = 0.4;
  // drift through tight corners (sign = direction of the turn), up to the difficulty's level
  let d = false;
  const DR = A.drift, N = tr.N;
  let curveAhead = 0, sign = 0;
  for (let j = 4; j < 20; j += 2) { const kp = line.kappa[(k.idx + j) % N]! * 60; if (kp > curveAhead) { curveAhead = kp; sign = Math.sign(wrapA(tr.ang[(k.idx + j + 4) % N]! - tr.ang[(k.idx + j) % N]!)); } }
  const lvl = T.driving.drift, maxDc = D.maxDrift >= 3 ? 9 : D.maxDrift === 2 ? lvl.level3 - 0.05 : lvl.level2 - 0.05;
  if (k.drift) {
    let still = 0;
    for (let j = 0; j < 8; j += 2) still = Math.max(still, line.kappa[(k.idx + j) % N]! * 60);
    d = still > DR.curveOut && k.dc < maxDc;
  } else d = curveAhead > DR.curveIn && k.speed > DR.minSpeed && s.branch < 0;
  let steer = clamp(diffA * 2.6, -1, 1);
  if (!k.drift && d) steer = sign || Math.sign(diffA) || 1;
  // tricks: Normal and Hard always trick on take-off, Easy one jump in three
  if (k.air && k.trickT > 0 && !k.trick && (s.diff > 0 || (w.tick + k.id) % 3 === 0)) d = true;
  if (s.mistake > 0) { s.mistake -= 1 / 60; steer = clamp(steer + (w.tick % 40 < 20 ? 0.6 : -0.6), -1, 1); t = Math.min(t, 0.5); }
  dbg.act = s.act; dbg.tx = tx; dbg.ty = ty; dbg.vt = vt;
  void cornerSpeed; void diffA;
  diffA = 0;
  return { t, s: steer, d, item: false };
}

/** Items: use when the item's aiScore beats the difficulty threshold, after the reaction time. */
export function aiItems(w: World, k: Kart, dt: number) {
  if (!k.item || k.roll > 0 || k.finished || k.spin > 0) return;
  k.hold += dt;
  const D = aiDiff(w, k), def = itemDef(k.item);
  if (k.hold < D.reaction) return;
  if (def.aiNotWhenFirst && k.rank === 0) return;
  const score = def.aiScore ? def.aiScore(w, k) : defaultScore(w, k, def.role);
  const dbg = aiDebug.get(k.id);
  if (dbg) dbg.item = score;
  if (score > D.itemThreshold) useItem(w, k);
}

/** Fallback scores by role (items can override with their own aiScore). */
export function defaultScore(w: World, k: Kart, role: string): number {
  const P = persona(k);
  switch (role) {
    case 'ataque': return Math.max(aimed(w, k, 260, 0.12), (rivalAhead(w, k, 300) ? 0.3 : 0) + k.hold * 0.03) * P.attack;
    case 'defensa': return Math.max(threatBehind(w, k) * 1.2 * P.defend, k.hold > 8 ? 0.7 : 0);
    case 'movilidad': return straightAhead(w, k) * 0.9 + rankRel(w, k) * 0.2;
    case 'trampa': { const b = rivalBehind(w, k, 160); return Math.max(b ? 0.9 * (1 - b[1] / 160) + 0.2 : 0, k.hold * 0.04); }
    default: return 0.45 + rankRel(w, k) * 0.4 + k.hold * 0.02;
  }
}

/** Rubber band v2: bounded speed multiplier against the best human; never repositions karts. */
export function rubberBand(w: World, k: Kart, bestHumanProg: number | null): number {
  const D = aiDiff(w, k), R = T.ai.rubberBand, N = w.track.N;
  if (bestHumanProg == null) return 1;
  const lastLapCut = w.cfg.laps * N - N * R.offLastLapFrac;
  if (bestHumanProg >= lastLapCut) return 1;
  const gap = (k.prog - bestHumanProg) / N, a = Math.abs(gap);
  if (a <= R.near) return 1;
  const f = clamp((a - R.near) / (R.far - R.near), 0, 1) * D.rubber;
  return gap < 0 ? 1 + f : 1 - f;
}
