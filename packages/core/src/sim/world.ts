// Race simulation (driving v2, docs/GDD.md §2). Fixed 60 Hz step, deterministic, no DOM.
import { SIM_DT } from '../constants';
import { CHARS } from '../data/characters';
import { datan2, dcos, dhypot, dpow, dsin } from '../dmath';
import { Rng, clamp, lerp, wrapA } from '../math';
import { T } from '../tunables';
import { type Track, hAt, lateralAt, liqAt, surfaceAt } from '../track/track';
import { aiDiff, aiInput, aiItems, newAiState, rubberBand } from '../ai/ai';
import { effectDefs, eachFx, fxOf, tickFx, type SpeedCtx } from './effects';
import './effectDefs';
import './hazards';
import { spawnTrackCoins } from './coins';
import { spawn, updateEntities, zoneAt } from './entities';
import { isTimed, spawnStaticHazards, spawnTimedHazard, hazardFamily, type HazardSpec } from './hazards';
import { bumpHooks, charOf, emit, isHuman, kartById, ouch } from './helpers';
import { giveItem, rollItem, useItem } from './items';
import '../items';
import '../modes';
import { modeOf } from './modes';
import type { Ctrl, Fx, Input, Kart, RaceConfig, World } from './types';
import { quantizeInput } from './types';

function makeKart(w: World, id: number, ch: number, ctrl: Ctrl, g: number, aiDiff?: number): Kart {
  const tr = w.track, G = T.race.grid;
  const row = g >> 1, back = G.first + row * G.row + (g & 1) * G.stagger, i = (((-back) % tr.N) + tr.N) % tr.N, a = tr.ang[i]!, lat = g & 1 ? G.lateral : -G.lateral;
  const x = tr.x[i]! - dsin(a) * lat, y = tr.y[i]! + dcos(a) * lat;
  const ai = ctrl === 'ai' ? newAiState(w, aiDiff) : null;
  return {
    id, ch, ctrl, x, y, z: hAt(tr, x, y), vz: 0, air: false, glide: false, a, va: a, speed: 0, idx: i, prog: -back,
    drift: 0, dc: 0, boost: 0, spin: 0, hop: 0, item: null, roll: 0, finished: false, time: null,
    hold: 0, sv: 0, backT: 0, lastLap: 1, rb: ai ? ai.speed : 1, lapStart: 0, best: null, respawn: 0, off: 0, rank: g, padT: 0,
    fx: [], lapFly: 0,
    spinK: T.driving.spinDecay, invuln: 0, wallT: 0, wallCD: 0, slip: 0, trickT: 0, trick: false, trickBig: false, dPrev: false, dLvl: 0,
    pressCd: -1, burnout: 0, heavyT: 0, lastItem: null, lat, surf: null, ai, stuckT: 0, coins: 0, itemN: 0, team: w.cfg.teams ? (w.cfg.grid[g]?.team ?? g % 2) : -1, out: false, balloons: 0, score: 0,
  };
}

/** Grid order for a race. Humans are placed at slot `humanSlot` (free race: 5, cup race 1: 7); cup races after the first sort by points. */
export function buildGrid(rng: Rng, humans: { ch: number; ctrl: Ctrl }[], opts: { cupPts?: Record<number, number>; humanSlot: number }) {
  const taken = new Set(humans.map((h) => h.ch));
  if (opts.cupPts) {
    const order = rng.shuffle(CHARS.map((_, i) => i)).sort((a, b) => opts.cupPts![b]! - opts.cupPts![a]!);
    return order.map((ch) => humans.find((h) => h.ch === ch) ?? { ch, ctrl: 'ai' as Ctrl });
  }
  const others = rng.shuffle(CHARS.map((_, i) => i).filter((i) => !taken.has(i))).map((ch) => ({ ch, ctrl: 'ai' as Ctrl }));
  others.splice(Math.min(opts.humanSlot, others.length), 0, ...humans);
  return others;
}

export function createWorld(cfg: RaceConfig, track: Track): World {
  if (!track.built) throw new Error('track not built');
  const w: World = {
    cfg, track, rng: new Rng(cfg.seed), tick: 0, karts: [], ents: [], nextEnt: 1,
    boxes: track.boxes.map(() => ({ active: true, t: 0 })),
    pairCD: [], raceT: 0, phase: 'countdown', cd: T.race.countdown, cdLast: 4, finishDelay: 0, ranked: [], finalOrder: [], events: [],
    water: track.water?.base ?? 0, highTierCD: 0, tideTarget: track.water?.base ?? 0, elimLap: 0,
  };
  w.karts = cfg.grid.map((g, i) => makeKart(w, i, g.ch, g.ctrl, i, g.aiDiff));
  w.pairCD = new Array(w.karts.length * w.karts.length).fill(0);
  w.ranked = w.karts.map((k) => k.id);
  spawnStaticHazards(w, spawn);
  spawnTrackCoins(w);
  modeOf(w).setup?.(w);
  return w;
}

function nearestFull(tr: Track, x: number, y: number): [number, number] {
  let best = 0, bd = 1e12;
  for (let i = 0; i < tr.N; i++) {
    const dx = tr.x[i]! - x, dy = tr.y[i]! - y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return [best, bd];
}

function locate(tr: Track, k: Kart): number {
  const N = tr.N;
  let best = k.idx, bd = 1e12;
  for (let j = -25; j <= 25; j++) {
    const i = (k.idx + j + N) % N, dx = tr.x[i]! - k.x, dy = tr.y[i]! - k.y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  if (bd > 130 * 130) { const r = nearestFull(tr, k.x, k.y); best = r[0]; bd = r[1]; }
  let dl = best - k.idx;
  if (dl > N / 2) dl -= N;
  if (dl < -N / 2) dl += N;
  k.prog += dl;
  k.idx = best;
  return Math.sqrt(bd);
}

/** Engine class multipliers (100cc / 150cc). */
const engineClass = (w: World) => (T.race.classes as Record<string, { speed: number; accel: number }>)[String(w.cfg.cc ?? 100)] ?? { speed: 1, accel: 1 };

/** Road width multiplier for this kart (snow narrowing the road lap after lap). */
function narrowing(tr: Track, k: Kart): number {
  const n = tr.authored?.narrow;
  if (!n) return 1;
  const i0 = Math.floor(n.from * tr.N), i1 = Math.floor(n.to * tr.N), i = k.idx;
  if (!(i0 <= i1 ? i >= i0 && i < i1 : i >= i0 || i < i1)) return 1;
  let m = 1;
  const lap = Math.floor(k.prog / tr.N) + 1;
  for (const [l, v] of Object.entries(n.laps)) if (lap >= Number(l)) m = v;
  return m;
}

/** Weather grip (rain, sandstorm) from its starting lap, by the kart's own lap. */
function weatherGrip(w: World, k: Kart): number {
  const wt = w.track.authored?.weather;
  if (!wt || Math.floor(k.prog / w.track.N) + 1 < wt.fromLap) return 1;
  return (T.race.weather as Record<string, { grip: number }>)[wt.kind]?.grip ?? 1;
}

/** Distance past the road edge (main road or shortcut); < 0 = on the road. */
function edgeDistance(tr: Track, k: Kart, d: number): number {
  let e = d - tr.wd[k.idx]! * narrowing(tr, k);
  for (const b of tr.branches) {
    const bw = b.w ?? 24;
    for (let i = 0; i < b.n; i++) {
      const dd = dhypot(b.x[i]! - k.x, b.y[i]! - k.y) - bw;
      if (dd < e) e = dd;
    }
  }
  return e;
}

const byRank = (a: Kart, b: Kart) => {
  if (a.out || b.out) return a.out && b.out ? b.time! - a.time! : a.out ? 1 : -1;
  if (a.finished && b.finished) return a.time! - b.time!;
  if (a.finished) return -1;
  if (b.finished) return 1;
  return b.prog - a.prog;
};
export function rankList(w: World): Kart[] {
  return w.karts.slice().sort(modeOf(w).rank ?? byRank);
}

function respawnKart(w: World, k: Kart) {
  const tr = w.track, i = k.idx, a = tr.ang[i]!;
  k.x = tr.x[i]!; k.y = tr.y[i]!; k.a = k.va = a; k.z = hAt(tr, k.x, k.y);
  k.vz = 0; k.air = false; k.glide = false; k.speed = 0; k.spin = 0; k.drift = 0; k.dLvl = 0;
  k.invuln = T.driving.hit.invuln;
}

/** Water depth at the kart (authored tides) — legacy liquid tracks use their baked mask. */
function waterDepth(w: World, k: Kart, ground: number): number {
  return w.track.water ? w.water - ground : -1;
}

/** Start a jump: opens the trick window. */
function takeOff(w: World, k: Kart) {
  const tr = w.track, TR = T.driving.trick;
  k.trickT = TR.takeoff;
  k.trick = false;
  k.trickBig = false;
  if (tr.authored) for (const r of tr.authored.ramps) if (r.big && Math.abs(((Math.floor(r.at * tr.N) - k.idx + tr.N + tr.N / 2) % tr.N) - tr.N / 2) < TR.bigRadius) k.trickBig = true;
}

// Reused scratch objects: no allocation per kart per tick.
const ctx: SpeedCtx = { w: null as unknown as World, k: null as unknown as Kart, inp: { t: 0, s: 0, d: false, item: false }, base: 0, max: 0, dt: 0 };
type SpeedHook = { order: number; type: string; apply: (c: SpeedCtx, f: Fx) => void };
let speedStage: SpeedHook[] | null = null;
function speedHooks(): SpeedHook[] {
  if (!speedStage) speedStage = effectDefs().filter((d) => d.speed).map((d) => ({ order: d.speed!.order, type: d.type, apply: d.speed!.apply })).sort((a, b) => a.order - b.order);
  return speedStage;
}
/** Zones (tar) and surfaces sit at order 30 in the speed pipeline. */
const ZONE_ORDER = 30;

function updateKart(w: World, k: Kart, input: Input, dt: number) {
  const st = charOf(k), tr = w.track, th = tr.th, N = tr.N, human = isHuman(k), D = T.driving;
  tickFx(k, dt);
  if (k.invuln > 0) k.invuln -= dt;
  if (k.wallT > 0) k.wallT -= dt;
  if (k.wallCD > 0) k.wallCD -= dt;
  if (k.burnout > 0) k.burnout -= dt;
  if (k.heavyT > 0) k.heavyT -= dt;
  if (k.respawn > 0) { k.respawn -= dt; if (k.respawn <= 0) respawnKart(w, k); return; }
  const cc = engineClass(w);
  const base = D.baseSpeed * st.spd * cc.speed * (human && !k.finished ? 1 : k.rb) * (1 + Math.min(k.coins, T.race.coins.max) * T.race.coins.speed);
  const prevProg = k.prog, pi = k.idx, d = locate(tr, k);
  const e = edgeDistance(tr, k, d);
  const off = e > D.offOut ? 2 : e > D.offEdge ? 1 : 0;
  k.off = off;
  k.lat = lateralAt(tr, k.idx, k.x, k.y);
  // flight ramps (legacy tracks)
  if (tr.flights.length && !k.air) {
    const dI = (k.idx - pi + N) % N;
    if (dI > 0 && dI < N / 2)
      for (const f of tr.flights) {
        const o = (f - pi + N) % N;
        if (o > 0 && o <= dI && d - tr.wd[k.idx]! < 10) {
          k.air = true; k.glide = true; k.vz = D.air.flightVz; k.drift = 0; k.dc = 0;
          takeOff(w, k);
          emit(w, { type: 'flight', kart: k.id });
          break;
        }
      }
  }
  // liquids: legacy baked mask, or dynamic water (tides) on authored tracks
  const ground = hAt(tr, k.x, k.y), depth = waterDepth(w, k, ground);
  const falls = tr.water ? !k.air && off >= 1 && depth > tr.water.fallDepth : !k.air && off === 2 && liqAt(tr, k.x, k.y);
  if (falls) {
    k.respawn = D.respawnTime; k.speed = 0; k.drift = 0; k.boost = 0; k.slip = 0;
    ouch(k, 1, 0);
    emit(w, { type: 'fall', kart: k.id });
    return;
  }
  if (!k.air) eachFx(k, (fd) => fd.onOffRoad?.(w, k, off));
  const zone = k.air ? undefined : zoneAt(w, k), inTar = !!zone;
  k.surf = k.air || off === 2 ? null : surfaceAt(tr, k.idx, k.lat) ?? (tr.water && depth > tr.water.puddleDepth ? 'charco' : null);
  const S = k.surf ? (T.surfaces as Record<string, { max: number; grip: number; drift: number }>)[k.surf] : undefined;
  // input pipeline: spin (active recovery: holding the throttle shortens it), effects, wall stun, burnout
  const inp = ctx.inp;
  inp.t = input.t; inp.s = input.s; inp.d = input.d; inp.item = input.item;
  if (k.spin > 0) {
    k.spin -= dt * (input.t > 0 ? D.hit.recoverMul : 1);
    inp.t = 0; inp.s = 0; inp.d = false; inp.item = false;
    k.speed *= dpow(k.spinK, dt);
    if (k.spin <= 0) { k.invuln = D.hit.invuln; if (st.weightClass === 'pesado') k.heavyT = D.hit.heavyAccelTime; }
  }
  let noBoost = false;
  eachFx(k, (fd, f) => { fd.input?.(k, inp, f, human); if (fd.noBoost) noBoost = true; });
  if (k.wallT > 0) inp.s = 0;
  if (k.burnout > 0) inp.t = 0;
  // speed pipeline: boost, effects with order < 30, zones + surfaces, effects with order ≥ 30
  ctx.w = w; ctx.k = k; ctx.base = base; ctx.dt = dt;
  ctx.max = off === 2 ? th.offMax : off === 1 ? D.edgeMax : base;
  if (k.boost > 0 && !noBoost) { k.boost -= dt; ctx.max = Math.max(ctx.max, base * D.boostMaxMul); if (k.speed < ctx.max) k.speed += D.boostAccel * dt; }
  let zoneDone = false;
  const applyZone = () => {
    zoneDone = true;
    if (S) ctx.max *= S.max;
    const ze = zone?.zoneEffect;
    if (!ze) return;
    if (ze.maxMul) ctx.max = Math.min(ctx.max, base * ze.maxMul());
    if (ze.cancelDrift) { k.drift = 0; k.dc = 0; inp.d = false; }
  };
  for (const h of speedHooks()) {
    if (!zoneDone && h.order >= ZONE_ORDER) applyZone();
    const f = fxOf(k, h.type);
    if (f) h.apply(ctx, f);
  }
  if (!zoneDone) applyZone();
  const max = ctx.max;
  k.padT -= dt;
  for (const p of tr.pads)
    if (k.padT <= 0 && dhypot(k.x - p.x, k.y - p.y) < D.pad.radius) { k.boost = Math.max(k.boost, D.pad.boost); k.padT = D.pad.cooldown; emit(w, { type: 'pad', kart: k.id }); }
  const AIR = D.air;
  if (!k.air) {
    const acc = D.accel * st.acl * cc.accel * (k.heavyT > 0 ? D.hit.heavyAccelMul : 1);
    if (inp.t > 0) k.speed += acc * inp.t * dt * (k.speed < 0 ? D.reverseAccelMul : 1);
    else if (inp.t < 0) k.speed -= (k.speed > 0 ? D.brake : D.brakeReverse) * -inp.t * dt;
    else k.speed -= Math.sign(k.speed) * Math.min(Math.abs(k.speed), D.coast * dt);
    if (k.speed > max) k.speed = Math.max(max, k.speed - (off || inTar || S ? D.overMaxDecelRough : D.overMaxDecel) * dt);
    const ca = dcos(k.a), sa = dsin(k.a), sl = (hAt(tr, k.x + ca * 5, k.y + sa * 5) - hAt(tr, k.x - ca * 5, k.y - sa * 5)) / 10;
    k.speed -= sl * D.slope * dt;
  } else {
    // in the air: the Flight stat speeds the kart up or slows it down
    if (k.glide) { const tgt = base * (AIR.glideBase + st.fly * AIR.glideFly); k.speed += clamp(tgt - k.speed, -AIR.glideRate * dt, AIR.glideRate * dt); }
    else k.speed += (st.fly - 5) * AIR.airFly * dt;
    k.lapFly += dt;
    // tricks: press drift during the take-off window
    if (k.trickT > 0) {
      k.trickT -= dt;
      if (inp.d && !k.dPrev && !k.trick) { k.trick = true; emit(w, { type: 'trick', kart: k.id }); }
    }
  }
  if (k.speed < D.reverseMax) k.speed = D.reverseMax;
  // drift: 3 mini-turbo levels
  const DR = D.drift;
  if (inp.d && !k.drift && !k.air && Math.abs(inp.s) > DR.minSteer && k.speed > DR.minSpeed && off < 2 && k.spin <= 0) {
    k.drift = Math.sign(inp.s); k.dc = 0; k.dLvl = 0; k.hop = DR.hop;
    emit(w, { type: 'driftStart', kart: k.id });
  }
  if (k.drift && (!inp.d || k.speed < DR.exitSpeed || off === 2 || k.air)) {
    const lvl = k.dLvl;
    if (lvl === 1 || lvl === 2 || lvl === 3) {
      k.boost = Math.max(k.boost, lvl === 3 ? DR.boost3 : lvl === 2 ? DR.boost2 : DR.boost1);
      emit(w, { type: 'miniTurbo', kart: k.id, level: lvl });
    }
    k.drift = 0; k.dc = 0; k.dLvl = 0;
  }
  let steer = inp.s;
  if (k.drift) {
    steer = k.drift * DR.steerBase + inp.s * DR.steerInput;
    k.dc += dt * (Math.sign(inp.s) === k.drift ? DR.chargeWith : DR.chargeAgainst) * (S ? S.drift : 1);
    const lvl = k.dc > DR.level3 ? 3 : k.dc > DR.level2 ? 2 : k.dc > DR.level1 ? 1 : 0;
    if (lvl > k.dLvl) { k.dLvl = lvl; emit(w, { type: 'driftLevel', kart: k.id, level: lvl as 1 | 2 | 3 }); }
  }
  const SR = D.steer, sf = clamp(Math.abs(k.speed) / SR.fullSpeed, 0, 1) * (k.speed < 0 ? -1 : 1);
  k.a = wrapA(k.a + steer * SR.rate * st.hnd * sf * dt * (k.drift ? DR.turnMul : 1) * (k.glide ? SR.glideMul : k.air ? SR.airMul : 1));
  if (k.glide) { const j = (k.idx + AIR.flightLook) % N; k.a = wrapA(k.a + wrapA(tr.ang[j]! - k.a) * Math.min(1, AIR.flightSnap * dt)); }
  let grip = off === 2 ? D.grip.offRoad : th.grip;
  if (S) grip *= S.grip;
  grip *= weatherGrip(w, k);
  if (zone?.zoneEffect?.grip) grip *= zone.zoneEffect.grip();
  if (k.air) grip = k.glide ? D.grip.glide : D.grip.air;
  const tgtA = k.a - k.drift * DR.slip;
  k.va = wrapA(k.va + wrapA(tgtA - k.va) * Math.min(1, grip * dt));
  k.x += dcos(k.va) * k.speed * dt;
  k.y += dsin(k.va) * k.speed * dt;
  wallCollide(w, k);
  const M = D.worldMargin, size = tr.size;
  if (k.x < M || k.y < M || k.x > size - M || k.y > size - M) {
    eachFx(k, (fd) => fd.onWorldBounds?.(k));
    k.x = clamp(k.x, M, size - M);
    k.y = clamp(k.y, M, size - M);
  }
  const g2 = hAt(tr, k.x, k.y);
  if (k.air) {
    k.vz -= (k.glide ? AIR.glideGravity : AIR.gravity) * dt;
    k.z += k.vz * dt;
    if (k.z <= g2) {
      emit(w, { type: 'land', kart: k.id, hard: k.vz < AIR.landHard });
      k.z = g2; k.air = false; k.glide = false; k.vz = 0;
      if (k.trick) { k.boost = Math.max(k.boost, k.trickBig ? D.trick.bigBoost : D.trick.boost); k.trick = false; }
      k.trickT = 0;
    }
  } else {
    const nvz = (g2 - k.z) / Math.max(dt, 1e-3);
    if (nvz < k.vz - AIR.gravity * dt - AIR.jumpDrop && k.speed > AIR.jumpMinSpeed) { k.air = true; k.z += k.vz * dt; takeOff(w, k); emit(w, { type: 'jump', kart: k.id }); }
    else { k.vz = lerp(k.vz, nvz, 0.5); k.z = g2; }
  }
  slipstream(w, k, dt);
  // stuck recovery: nearly stopped for a while (against a slope, off-road...) → back on the road
  const SU = D.stuck;
  if (Math.abs(k.speed) < SU.speed && k.spin <= 0 && !k.finished && (off >= 1 || !human)) k.stuckT += dt;
  else k.stuckT = 0;
  if (k.stuckT > (human ? SU.humanTime : SU.aiTime)) {
    k.stuckT = 0;
    k.respawn = SU.respawn;
    emit(w, { type: 'fall', kart: k.id });
  }
  k.dPrev = input.d;
  k.hop = Math.max(0, k.hop - dt);
  k.sv = lerp(k.sv, steer, Math.min(1, SR.smooth * dt));
  if (k.prog < prevProg && k.speed > D.wrongWay.minSpeed) k.backT += dt;
  else k.backT = Math.max(0, k.backT - dt * D.wrongWay.recover);
  if (k.roll > 0) { k.roll -= dt; if (k.roll <= 0) giveItem(w, k, rollItem(w, k, st.luck)); }
  if (!human) aiItems(w, k, dt);
  const laps = w.cfg.laps;
  if (!k.finished && k.prog >= laps * N) {
    k.finished = true;
    k.time = w.raceT;
    emit(w, { type: 'finish', kart: k.id, time: w.raceT });
  }
  const lap = Math.floor(k.prog / N) + 1;
  if (!k.finished && lap > k.lastLap) {
    if (human) { const lt = w.raceT - k.lapStart; k.best = k.best == null ? lt : Math.min(k.best, lt); k.lapStart = w.raceT; }
    emit(w, { type: 'lap', kart: k.id, lap, final: lap === laps });
    k.lastLap = lap;
  }
}

/** Hard walls along the road: reflect the normal velocity, lose speed, short stun on head-on hits. */
function wallCollide(w: World, k: Kart) {
  const tr = w.track, i = k.idx;
  if (!tr.wallL[i] && !tr.wallR[i]) return;
  const WL = T.driving.wall, lat = lateralAt(tr, i, k.x, k.y), lim = tr.wd[i]! + WL.gap;
  let side = 0;
  if (lat > lim && tr.wallR[i]) side = 1;
  else if (lat < -lim && tr.wallL[i]) side = -1;
  if (!side) return;
  const a = tr.ang[i]!, rx = -dsin(a), ry = dcos(a);
  const pen = Math.abs(lat) - lim;
  k.x -= rx * pen * side; k.y -= ry * pen * side;
  let vx = dcos(k.va) * k.speed, vy = dsin(k.va) * k.speed;
  const vn = (vx * rx + vy * ry) * side; // velocity into the wall
  if (vn <= 0) return;
  const goma = !!fxOf(k, 'goma'), e = goma ? WL.gomaRestitution : WL.restitution;
  vx -= (1 + e) * vn * rx * side; vy -= (1 + e) * vn * ry * side;
  const v = dhypot(vx, vy), hard = vn / Math.max(1, Math.abs(k.speed)) > dsin(WL.stunAngle);
  k.speed = v * (goma ? 1 : WL.keep);
  k.va = datan2(vy, vx);
  k.a = wrapA(k.a + wrapA(k.va - k.a) * WL.faceBlend);
  if (hard) k.wallT = WL.stun;
  if (k.wallCD <= 0) { emit(w, { type: 'wallBump', kart: k.id, hard }); k.wallCD = WL.cooldown; }
}

/** Slipstream: charge while tucked behind another kart; boost when full. */
function slipstream(w: World, k: Kart, dt: number) {
  const SL = T.driving.slipstream;
  if (k.air || k.spin > 0 || k.speed < SL.minSpeed) { k.slip = Math.max(0, k.slip - dt * SL.drain); return; }
  let tucked = false;
  for (const o of w.karts) {
    if (o === k || o.respawn > 0) continue;
    const dx = o.x - k.x, dy = o.y - k.y, d = dhypot(dx, dy);
    if (d < SL.range && d > 8 && Math.abs(wrapA(datan2(dy, dx) - k.a)) < SL.cone) { tucked = true; break; }
  }
  if (tucked) {
    k.slip += dt;
    if (k.slip >= SL.charge) { k.slip = 0; k.boost = Math.max(k.boost, SL.boost); emit(w, { type: 'slipstream', kart: k.id }); }
  } else k.slip = Math.max(0, k.slip - dt * SL.drain);
}

/** The race leader the AI rubber-bands against: best human. */
function referenceProg(w: World): number | null {
  let best: number | null = null;
  for (const k of w.karts) if (isHuman(k)) best = best == null ? k.prog : Math.max(best, k.prog);
  return best;
}

function bumpScale(k: Kart): number {
  let s = 1;
  eachFx(k, (d) => { if (d.bumpScale && d.bumpScale > s) s = d.bumpScale; });
  return s;
}

/** Track hazards on a timer (waves...) and the tide. */
function updateTrackEvents(w: World, dt: number) {
  const tr = w.track, a = tr.authored;
  if (a) {
    for (const h of a.hazards as HazardSpec[]) {
      if (!isTimed(h.kind)) continue;
      const t1 = (w.raceT + (h.offset ?? 0)) % h.period, t0 = (w.raceT - dt + (h.offset ?? 0)) % h.period;
      const warnAt = h.period - h.warn, eruption = hazardFamily(h.kind) === 'eruption';
      if (t0 < warnAt && t1 >= warnAt) {
        emit(w, { type: 'hazardWarn', kind: h.kind, at: h.at });
        if (eruption) spawnTimedHazard(w, h, spawn); // eruptions show their warning on the ground
      }
      if (t1 < t0) {
        if (!eruption) spawnTimedHazard(w, h, spawn);
        emit(w, { type: 'hazard', kind: h.kind, at: h.at });
      }
    }
  }
  const W = tr.water;
  if (W) {
    let lead = 0;
    for (const k of w.karts) lead = Math.max(lead, Math.floor(k.prog / tr.N) + 1);
    let target = W.base;
    for (const [lap, lvl] of Object.entries(W.laps)) if (lead >= Number(lap)) target = lvl;
    if (target !== w.tideTarget) { w.tideTarget = target; emit(w, { type: 'tide', level: target }); }
    w.water += clamp(target - w.water, -W.rate * dt, W.rate * dt);
  }
}

function updateRace(w: World, inputs: readonly Input[], dt: number) {
  w.raceT += dt;
  if (w.highTierCD > 0) w.highTierCD -= dt;
  const tr = w.track, pp = referenceProg(w);
  const ranked = rankList(w);
  ranked.forEach((k, i) => (k.rank = i));
  w.ranked = ranked.map((k) => k.id);
  for (const k of w.karts) if (k.ai) k.rb = k.ai.speed * rubberBand(w, k, pp);
  for (const k of w.karts) {
    let inp: Input;
    if (!isHuman(k) || k.finished) {
      if (!k.ai) k.ai = newAiState(w);
      inp = quantizeInput(aiInput(w, k));
    } else {
      inp = quantizeInput(inputs[k.id]);
      if (inp.item && w.phase === 'race' && k.item && k.roll <= 0) useItem(w, k);
    }
    updateKart(w, k, inp, dt);
  }
  // bumps: the lighter kart is pushed (more if it is a lightweight); effects add their own reactions
  const n = w.karts.length, B = T.race.bump, WG = T.driving.weight;
  for (let i = 0; i < w.pairCD.length; i++) if (w.pairCD[i]! > 0) w.pairCD[i]! -= dt;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = w.karts[i]!, b = w.karts[j]!;
      if (a.respawn > 0 || b.respawn > 0 || Math.abs(a.z - b.z) > B.zTolerance) continue;
      const rad = (B.size * (bumpScale(a) + bumpScale(b))) / 2, dx = b.x - a.x, dy = b.y - a.y, d = dhypot(dx, dy);
      if (d >= rad || d < 0.01) continue;
      const nx = dx / d, ny = dy / d, p = (rad - d) / 2;
      a.x -= nx * p; a.y -= ny * p; b.x += nx * p; b.y += ny * p;
      const key = i * n + j;
      if (w.pairCD[key]! > 0) continue;
      w.pairCD[key] = B.cooldown;
      eachFx(a, (fd) => fd.onBump?.(w, a, b));
      eachFx(b, (fd) => fd.onBump?.(w, b, a));
      const dw = charOf(a).w - charOf(b).w;
      if (Math.abs(dw) > 0.01) {
        const light = dw > 0 ? b : a, s = light === b ? 1 : -1, cls = charOf(light).weightClass;
        const ex = B.weightPush * B.size * Math.abs(dw) * (cls === 'ligero' ? WG.lightPushMul : cls === 'pesado' ? WG.heavyPushMul : 1);
        light.x += nx * s * ex; light.y += ny * s * ex; light.speed *= B.lightSlow;
      }
      for (const h of bumpHooks) h(w, a, b);
      eachFx(a, (fd) => fd.bumpPush?.(a, nx, ny, -1));
      eachFx(b, (fd) => fd.bumpPush?.(b, nx, ny, 1));
      emit(w, { type: 'bump', a: a.id, b: b.id });
    }
  // item boxes
  const I = T.items;
  for (let bi = 0; modeOf(w).itemBoxes !== false && bi < tr.boxes.length; bi++) {
    const b = tr.boxes[bi]!, bs = w.boxes[bi]!;
    if (!bs.active) { bs.t -= dt; if (bs.t <= 0) bs.active = true; continue; }
    for (const k of w.karts) {
      if (k.respawn <= 0 && dhypot(k.x - b.x, k.y - b.y) < I.boxRadius && Math.abs(k.z - b.z) < I.boxHeight) {
        bs.active = false; bs.t = I.boxRespawn;
        if (!k.item && k.roll <= 0) {
          if (isHuman(k)) { k.roll = I.rollTime; emit(w, { type: 'itemRoll', kart: k.id }); }
          else giveItem(w, k, rollItem(w, k, charOf(k).luck));
        }
        break;
      }
    }
  }
  updateTrackEvents(w, dt);
  updateEntities(w, dt);
  modeOf(w).tick?.(w);
  // end of race: `finishDelay` seconds after the mode's end condition
  if (w.phase === 'race') {
    if (w.finishDelay <= 0 && modeOf(w).endCondition(w)) w.finishDelay = T.race.finishDelay;
    else if (w.finishDelay > 0) {
      w.finishDelay -= dt;
      if (w.finishDelay <= 0) {
        w.phase = 'results';
        w.finalOrder = rankList(w).map((k) => k.id);
        emit(w, { type: 'raceEnd' });
      }
    }
  }
}

/** Countdown: rocket start by timing the throttle press (GDD §2.3); holding too early burns the tyres. */
function countdown(w: World, inputs: readonly Input[], dt: number) {
  const R = T.driving.rocketStart;
  w.cd -= dt;
  for (const k of w.karts) {
    if (!isHuman(k)) continue;
    const t = quantizeInput(inputs[k.id]).t;
    if (t > 0 && k.pressCd < 0) k.pressCd = w.cd;
    if (t <= 0) k.pressCd = -1;
  }
  const n = Math.ceil(w.cd);
  if (n < w.cdLast && n > 0) { w.cdLast = n; emit(w, { type: 'countdown', n }); }
  if (w.cd > 0) return;
  w.phase = 'race';
  emit(w, { type: 'go' });
  const D = aiDiff(w);
  for (const k of w.karts) {
    let boost = 0;
    if (isHuman(k)) {
      const p = k.pressCd;
      if (p > R.burnoutFrom) { k.burnout = R.burnout; emit(w, { type: 'burnout', kart: k.id }); }
      else if (p <= R.best[0]! && p > R.best[1]!) boost = R.bestBoost;
      else if (p <= R.good[0]! && p > R.good[1]!) boost = R.goodBoost;
    } else if (w.rng.next() < D.rocket) boost = R.goodBoost;
    if (boost > 0) { k.boost = boost; k.speed = R.speed; emit(w, { type: 'rocketStart', kart: k.id }); }
  }
}

/** Advance the world by one fixed tick (1/60 s). `inputs[kartId]` is read for human karts. */
export function step(w: World, inputs: readonly Input[]) {
  const dt = SIM_DT;
  w.tick++;
  if (w.phase === 'countdown') { countdown(w, inputs, dt); return; }
  updateRace(w, inputs, dt);
}

/** Drain events produced since the last call. */
export function takeEvents(w: World) {
  const e = w.events;
  w.events = [];
  return e;
}

export { kartById, aiInput };
