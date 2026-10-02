import { ROAD, SIM_DT, TS } from '../constants';
import { CHARS } from '../data/characters';
import { DIFFS } from '../data/tracks';
import { datan2, dcos, dhypot, dpow, dsin } from '../dmath';
import { Rng, clamp, lerp, wrapA } from '../math';
import { T } from '../tunables';
import { type Track, hAt, liqAt } from '../track/track';
import { effectDefs, eachFx, fxOf, tickFx, type SpeedCtx } from './effects';
import './effectDefs';
import { updateEntities, zoneAt } from './entities';
import { charOf, emit, isHuman, kartById, ouch } from './helpers';
import { aiItemUse, giveItem, rollItem, useItem } from './items';
import '../items';
import { modeOf } from './modes';
import type { Ctrl, Fx, Input, Kart, RaceConfig, World } from './types';
import { quantizeInput } from './types';

function makeKart(w: World, id: number, ch: number, ctrl: Ctrl, g: number): Kart {
  const tr = w.track, Df = DIFFS[w.cfg.diff]!, G = T.race.grid;
  const row = g >> 1, back = G.first + row * G.row + (g & 1) * G.stagger, i = (((-back) % tr.N) + tr.N) % tr.N, a = tr.ang[i]!, lat = g & 1 ? G.lateral : -G.lateral;
  const x = tr.x[i]! - dsin(a) * lat, y = tr.y[i]! + dcos(a) * lat;
  return {
    id, ch, ctrl, x, y, z: hAt(tr, x, y), vz: 0, air: false, glide: false, a, va: a, speed: 0, idx: i, prog: -back,
    drift: 0, dc: 0, boost: 0, spin: 0, hop: 0, item: null, roll: 0, finished: false, time: null,
    lane: w.rng.range(-T.race.ai.laneStart, T.race.ai.laneStart), laneT: 0, skill: w.rng.range(Df.sk[0], Df.sk[1]),
    hold: 0, useAt: 2, sv: 0, backT: 0, lastLap: 1, rb: 1, held: 0, lapStart: 0, best: null, respawn: 0, off: 0, rank: g, padT: 0,
    fx: [], lapFly: 0,
  };
}

/** Grid order for a race (legacy `startRace`). Humans are placed at slot `humanSlot` (free race: 5, cup race 1: 7); cup races after the first sort by points. */
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
  };
  w.karts = cfg.grid.map((g, i) => makeKart(w, i, g.ch, g.ctrl, i));
  w.pairCD = new Array(w.karts.length * w.karts.length).fill(0);
  w.ranked = w.karts.map((k) => k.id);
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

const byRank = (a: Kart, b: Kart) => {
  if (a.finished && b.finished) return a.time! - b.time!;
  if (a.finished) return -1;
  if (b.finished) return 1;
  return b.prog - a.prog;
};
export function rankList(w: World): Kart[] {
  return w.karts.slice().sort(byRank);
}

function respawnKart(w: World, k: Kart) {
  const tr = w.track, i = k.idx, a = tr.ang[i]!;
  k.x = tr.x[i]!; k.y = tr.y[i]!; k.a = k.va = a; k.z = hAt(tr, k.x, k.y);
  k.vz = 0; k.air = false; k.glide = false; k.speed = 0; k.spin = 0; k.drift = 0;
}

/** Legacy AI steering: follow the centerline with a random lane offset. */
export function aiInput(w: World, k: Kart): Input {
  const tr = w.track, N = tr.N, A = T.race.ai;
  if (k.laneT <= 0) { k.laneT = w.rng.range(A.laneMin, A.laneMax); k.lane = w.rng.range(-A.lane, A.lane); }
  const look = Math.round(A.lookBase + Math.max(0, k.speed) / A.lookDiv), i = (k.idx + look) % N, a = tr.ang[i]!;
  const tx = tr.x[i]! - dsin(a) * k.lane, ty = tr.y[i]! + dcos(a) * k.lane;
  const diffA = wrapA(datan2(ty - k.y, tx - k.x) - k.a);
  const curve = Math.abs(wrapA(tr.ang[(k.idx + A.curveLook) % N]! - tr.ang[k.idx]!));
  const lim = tr.th.ice ? A.limitIce : A.limit;
  let t = 1;
  if (curve > A.curveMax && k.speed > lim) t = 0;
  if (Math.abs(diffA) > A.wideAngle) t = A.wideThrottle;
  return { t, s: clamp(diffA * A.steerGain, -1, 1), d: false, item: false };
}

// Reused scratch objects: no allocation per kart per tick.
const ctx: SpeedCtx = { w: null as unknown as World, k: null as unknown as Kart, inp: { t: 0, s: 0, d: false, item: false }, base: 0, max: 0, dt: 0 };
type SpeedHook = { order: number; type: string; apply: (c: SpeedCtx, f: Fx) => void };
let speedStage: SpeedHook[] | null = null;
function speedHooks(): SpeedHook[] {
  if (!speedStage) speedStage = effectDefs().filter((d) => d.speed).map((d) => ({ order: d.speed!.order, type: d.type, apply: d.speed!.apply })).sort((a, b) => a.order - b.order);
  return speedStage;
}
/** Zones (tar) sit at order 30 in the speed pipeline. */
const ZONE_ORDER = 30;

function updateKart(w: World, k: Kart, input: Input, dt: number) {
  const st = charOf(k), tr = w.track, th = tr.th, N = tr.N, human = isHuman(k), D = T.driving;
  tickFx(k, dt);
  if (k.respawn > 0) { k.respawn -= dt; if (k.respawn <= 0) respawnKart(w, k); return; }
  const base = D.baseSpeed * st.spd * (human && !k.finished ? 1 : k.rb);
  const prevProg = k.prog, pi = k.idx, d = locate(tr, k);
  const off = d > ROAD + D.offOut ? 2 : d > ROAD + D.offEdge ? 1 : 0;
  k.off = off;
  // flight ramps
  if (tr.flights.length && !k.air) {
    const dI = (k.idx - pi + N) % N;
    if (dI > 0 && dI < N / 2)
      for (const f of tr.flights) {
        const o = (f - pi + N) % N;
        if (o > 0 && o <= dI && d < ROAD + 10) {
          k.air = true; k.glide = true; k.vz = D.air.flightVz; k.drift = 0; k.dc = 0;
          emit(w, { type: 'flight', kart: k.id });
          break;
        }
      }
  }
  if (!k.air && off === 2 && liqAt(tr, k.x, k.y)) {
    k.respawn = D.respawnTime; k.speed = 0; k.drift = 0; k.boost = 0;
    ouch(k, 1, 0);
    emit(w, { type: 'fall', kart: k.id });
    return;
  }
  if (!k.air) eachFx(k, (fd) => fd.onOffRoad?.(w, k, off));
  const zone = k.air ? undefined : zoneAt(w, k), inTar = !!zone;
  // input pipeline: spin, then each effect's input hook (registration order)
  const inp = ctx.inp;
  inp.t = input.t; inp.s = input.s; inp.d = input.d; inp.item = input.item;
  if (k.spin > 0) { k.spin -= dt; inp.t = 0; inp.s = 0; inp.d = false; inp.item = false; k.speed *= dpow(D.spinDecay, dt); }
  let noBoost = false;
  eachFx(k, (fd, f) => { fd.input?.(k, inp, f, human); if (fd.noBoost) noBoost = true; });
  // speed pipeline: boost, effects with order < 30, zones, effects with order ≥ 30
  ctx.w = w; ctx.k = k; ctx.base = base; ctx.dt = dt;
  ctx.max = off === 2 ? th.offMax : off === 1 ? D.edgeMax : base;
  if (k.boost > 0 && !noBoost) { k.boost -= dt; ctx.max = Math.max(ctx.max, base * D.boostMaxMul); if (k.speed < ctx.max) k.speed += D.boostAccel * dt; }
  let zoneDone = false;
  const applyZone = () => {
    zoneDone = true;
    const ze = zone?.zoneEffect;
    if (!ze) return;
    ctx.max = Math.min(ctx.max, base * ze.maxMul());
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
    if (inp.t > 0) k.speed += D.accel * st.acl * dt * (k.speed < 0 ? D.reverseAccelMul : 1);
    else if (inp.t < 0) k.speed -= (k.speed > 0 ? D.brake : D.brakeReverse) * dt;
    else k.speed -= Math.sign(k.speed) * Math.min(Math.abs(k.speed), D.coast * dt);
    if (k.speed > max) k.speed = Math.max(max, k.speed - (off || inTar ? D.overMaxDecelRough : D.overMaxDecel) * dt);
    const ca = dcos(k.a), sa = dsin(k.a), sl = (hAt(tr, k.x + ca * 5, k.y + sa * 5) - hAt(tr, k.x - ca * 5, k.y - sa * 5)) / 10;
    k.speed -= sl * D.slope * dt;
  } else {
    // in the air: the Flight stat speeds the kart up or slows it down
    if (k.glide) { const tgt = base * (AIR.glideBase + st.fly * AIR.glideFly); k.speed += clamp(tgt - k.speed, -AIR.glideRate * dt, AIR.glideRate * dt); }
    else k.speed += (st.fly - 5) * AIR.airFly * dt;
    k.lapFly += dt;
  }
  if (k.speed < D.reverseMax) k.speed = D.reverseMax;
  const DR = D.drift;
  if (inp.d && !k.drift && !k.air && Math.abs(inp.s) > DR.minSteer && k.speed > DR.minSpeed && off < 2 && k.spin <= 0) {
    k.drift = Math.sign(inp.s); k.dc = 0; k.hop = DR.hop;
    emit(w, { type: 'driftStart', kart: k.id });
  }
  if (k.drift && (!inp.d || k.speed < DR.exitSpeed || off === 2 || k.air)) {
    if (k.dc > DR.level2) { k.boost = Math.max(k.boost, DR.boost2); emit(w, { type: 'miniTurbo', kart: k.id, level: 2 }); }
    else if (k.dc > DR.level1) { k.boost = Math.max(k.boost, DR.boost1); emit(w, { type: 'miniTurbo', kart: k.id, level: 1 }); }
    k.drift = 0; k.dc = 0;
  }
  let steer = inp.s;
  if (k.drift) { steer = k.drift * DR.steerBase + inp.s * DR.steerInput; k.dc += dt * (Math.sign(inp.s) === k.drift ? DR.chargeWith : DR.chargeAgainst); }
  const S = D.steer, sf = clamp(Math.abs(k.speed) / S.fullSpeed, 0, 1) * (k.speed < 0 ? -1 : 1);
  k.a = wrapA(k.a + steer * S.rate * st.hnd * sf * dt * (k.drift ? DR.turnMul : 1) * (k.glide ? S.glideMul : k.air ? S.airMul : 1));
  if (k.glide) { const j = (k.idx + AIR.flightLook) % N; k.a = wrapA(k.a + wrapA(tr.ang[j]! - k.a) * Math.min(1, AIR.flightSnap * dt)); }
  let grip = off === 2 ? D.grip.offRoad : th.grip;
  if (k.air) grip = k.glide ? D.grip.glide : D.grip.air;
  const tgtA = k.a - k.drift * DR.slip;
  k.va = wrapA(k.va + wrapA(tgtA - k.va) * Math.min(1, grip * dt));
  k.x += dcos(k.va) * k.speed * dt;
  k.y += dsin(k.va) * k.speed * dt;
  const M = D.worldMargin;
  if (k.x < M || k.y < M || k.x > TS - M || k.y > TS - M) {
    eachFx(k, (fd) => fd.onWorldBounds?.(k));
    k.x = clamp(k.x, M, TS - M);
    k.y = clamp(k.y, M, TS - M);
  }
  const g2 = hAt(tr, k.x, k.y);
  if (k.air) {
    k.vz -= (k.glide ? AIR.glideGravity : AIR.gravity) * dt;
    k.z += k.vz * dt;
    if (k.z <= g2) { emit(w, { type: 'land', kart: k.id, hard: k.vz < AIR.landHard }); k.z = g2; k.air = false; k.glide = false; k.vz = 0; }
  } else {
    const nvz = (g2 - k.z) / Math.max(dt, 1e-3);
    if (nvz < k.vz - AIR.gravity * dt - AIR.jumpDrop && k.speed > AIR.jumpMinSpeed) { k.air = true; k.z += k.vz * dt; emit(w, { type: 'jump', kart: k.id }); }
    else { k.vz = lerp(k.vz, nvz, 0.5); k.z = g2; }
  }
  k.hop = Math.max(0, k.hop - dt);
  k.sv = lerp(k.sv, steer, Math.min(1, S.smooth * dt));
  k.laneT -= dt;
  if (k.prog < prevProg && k.speed > D.wrongWay.minSpeed) k.backT += dt;
  else k.backT = Math.max(0, k.backT - dt * D.wrongWay.recover);
  if (k.roll > 0) { k.roll -= dt; if (k.roll <= 0) giveItem(w, k, rollItem(w, k, st.luck)); }
  if (!human) aiItemUse(w, k, dt);
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

/** The race leader the AI rubber-bands against: best human (legacy: the player). */
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

function updateRace(w: World, inputs: readonly Input[], dt: number) {
  w.raceT += dt;
  const tr = w.track, N = tr.N, Df = DIFFS[w.cfg.diff]!, pp = referenceProg(w), RB = T.race.rubberBand;
  const ranked = rankList(w);
  ranked.forEach((k, i) => (k.rank = i));
  w.ranked = ranked.map((k) => k.id);
  for (const k of w.karts)
    if (!isHuman(k)) {
      const df = pp == null ? 0 : k.prog - pp;
      k.rb = k.skill * (df > N * RB.far ? Df.dn : df < -N * RB.far ? Df.up : df < -N * RB.near ? (1 + Df.up) / 2 : 1);
    }
  for (const k of w.karts) {
    let inp: Input;
    if (!isHuman(k) || k.finished) inp = aiInput(w, k);
    else {
      inp = quantizeInput(inputs[k.id]);
      if (inp.item && w.phase === 'race' && k.item && k.roll <= 0) useItem(w, k);
    }
    updateKart(w, k, inp, dt);
  }
  // bumps: the lighter kart is pushed 10% of the kart size × weight difference; effects add their own reactions
  const n = w.karts.length, B = T.race.bump;
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
        const light = dw > 0 ? b : a, s = light === b ? 1 : -1, ex = B.weightPush * B.size * Math.abs(dw);
        light.x += nx * s * ex; light.y += ny * s * ex; light.speed *= B.lightSlow;
      }
      eachFx(a, (fd) => fd.bumpPush?.(a, nx, ny, -1));
      eachFx(b, (fd) => fd.bumpPush?.(b, nx, ny, 1));
      emit(w, { type: 'bump', a: a.id, b: b.id });
    }
  // item boxes
  const I = T.items;
  for (let bi = 0; bi < tr.boxes.length; bi++) {
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
  updateEntities(w, dt);
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

/** Advance the world by one fixed tick (1/60 s). `inputs[kartId]` is read for human karts. */
export function step(w: World, inputs: readonly Input[]) {
  const dt = SIM_DT;
  w.tick++;
  if (w.phase === 'countdown') {
    w.cd -= dt;
    const R = T.driving.rocketStart;
    for (const k of w.karts) if (isHuman(k)) { if (quantizeInput(inputs[k.id]).t > 0) k.held += dt; else k.held = 0; }
    const n = Math.ceil(w.cd);
    if (n < w.cdLast && n > 0) { w.cdLast = n; emit(w, { type: 'countdown', n }); }
    if (w.cd <= 0) {
      w.phase = 'race';
      emit(w, { type: 'go' });
      for (const k of w.karts)
        if (isHuman(k) && k.held > 0 && k.held < R.holdMax) { k.boost = R.boost; k.speed = R.speed; emit(w, { type: 'rocketStart', kart: k.id }); }
    }
    return;
  }
  updateRace(w, inputs, dt);
}

/** Drain events produced since the last call. */
export function takeEvents(w: World) {
  const e = w.events;
  w.events = [];
  return e;
}

export { kartById };
