import { KSIZE, ROAD, SIM_DT, TS } from '../constants';
import { CHARS } from '../data/characters';
import { DIFFS } from '../data/tracks';
import { Rng, clamp, lerp, wrapA } from '../math';
import { type Track, dgAt, hAt, liqAt } from '../track/track';
import { charOf, emit, hit, isHuman, kartById } from './helpers';
import { aiItemUse, giveItem, rollItem, useItem } from './items';
import type { Ctrl, Input, Kart, RaceConfig, World } from './types';
import { NO_INPUT, quantizeInput } from './types';
import { datan2, dcos, dhypot, dpow, dsin } from '../dmath';

function makeKart(w: World, id: number, ch: number, ctrl: Ctrl, g: number): Kart {
  const tr = w.track, Df = DIFFS[w.cfg.diff]!;
  const row = g >> 1, back = 8 + row * 7 + (g & 1) * 3, i = (((-back) % tr.N) + tr.N) % tr.N, a = tr.ang[i]!, lat = g & 1 ? 15 : -15;
  const x = tr.x[i]! - dsin(a) * lat, y = tr.y[i]! + dcos(a) * lat;
  return {
    id, ch, ctrl, x, y, z: hAt(tr, x, y), vz: 0, air: false, glide: false, a, va: a, speed: 0, idx: i, prog: -back,
    drift: 0, dc: 0, boost: 0, spin: 0, hop: 0, item: null, roll: 0, finished: false, time: null,
    lane: w.rng.range(-18, 18), laneT: 0, skill: w.rng.range(Df.sk[0], Df.sk[1]),
    hold: 0, useAt: 2, sv: 0, backT: 0, lastLap: 1, rb: 1, held: 0, lapStart: 0, best: null, respawn: 0, off: 0, rank: g, padT: 0, ouch: 0, ouchT: 0,
    emp: 0, inv: 0, hookT: 0, hookTg: -1, slowT: 0, jug: 0, goma: 0, bubble: 0, smudge: 0, scare: 0, flyT: 0, lapFly: 0,
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
    cfg, track, rng: new Rng(cfg.seed), tick: 0, karts: [], rockets: [], shots: [], fakes: [], tars: [], holes: [],
    boxes: track.boxes.map(() => ({ active: true, t: 0 })),
    pairCD: [], raceT: 0, phase: 'countdown', cd: 3.999, cdLast: 4, finishDelay: 0, ranked: [], finalOrder: [], events: [],
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

export function rankList(w: World): Kart[] {
  return w.karts.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.time! - b.time!;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.prog - a.prog;
  });
}

function respawnKart(w: World, k: Kart) {
  const tr = w.track, i = k.idx, a = tr.ang[i]!;
  k.x = tr.x[i]!; k.y = tr.y[i]!; k.a = k.va = a; k.z = hAt(tr, k.x, k.y);
  k.vz = 0; k.air = false; k.glide = false; k.speed = 0; k.spin = 0; k.drift = 0;
}

/** Legacy AI steering: follow the centerline with a random lane offset. */
export function aiInput(w: World, k: Kart): Input {
  const tr = w.track, N = tr.N;
  if (k.laneT <= 0) { k.laneT = w.rng.range(1.5, 4); k.lane = w.rng.range(-22, 22); }
  const look = Math.round(8 + Math.max(0, k.speed) / 18), i = (k.idx + look) % N, a = tr.ang[i]!;
  const tx = tr.x[i]! - dsin(a) * k.lane, ty = tr.y[i]! + dcos(a) * k.lane;
  const diffA = wrapA(datan2(ty - k.y, tx - k.x) - k.a);
  const curve = Math.abs(wrapA(tr.ang[(k.idx + 28) % N]! - tr.ang[k.idx]!));
  const lim = tr.th.ice ? 95 : 112;
  let t = 1;
  if (curve > 1.1 && k.speed > lim) t = 0;
  if (Math.abs(diffA) > 1.4) t = 0.3;
  return { t, s: clamp(diffA * 2.6, -1, 1), d: false, item: false };
}

const TIMERS = ['ouch', 'scare', 'emp', 'inv', 'hookT', 'slowT', 'jug', 'goma', 'smudge'] as const;

function updateKart(w: World, k: Kart, inp: Input, dt: number) {
  const st = charOf(k), tr = w.track, th = tr.th, N = tr.N, human = isHuman(k);
  for (const f of TIMERS) if (k[f] > 0) k[f] -= dt;
  if (k.respawn > 0) { k.respawn -= dt; if (k.respawn <= 0) respawnKart(w, k); return; }
  const base = 142 * st.spd * (human && !k.finished ? 1 : k.rb);
  const prevProg = k.prog, pi = k.idx, d = locate(tr, k);
  const off = d > ROAD + 13 ? 2 : d > ROAD + 5 ? 1 : 0;
  k.off = off;
  // flight ramps
  if (tr.flights.length && !k.air) {
    const dI = (k.idx - pi + N) % N;
    if (dI > 0 && dI < N / 2)
      for (const f of tr.flights) {
        const o = (f - pi + N) % N;
        if (o > 0 && o <= dI && d < ROAD + 10) {
          k.air = true; k.glide = true; k.vz = 118; k.drift = 0; k.dc = 0;
          emit(w, { type: 'flight', kart: k.id });
          break;
        }
      }
  }
  if (!k.air && off === 2 && liqAt(tr, k.x, k.y)) {
    k.respawn = 1.2; k.speed = 0; k.drift = 0; k.boost = 0; k.ouch = 1; k.ouchT = 0;
    emit(w, { type: 'fall', kart: k.id });
    return;
  }
  if (k.bubble && off >= 1 && !k.air) { k.bubble = 0; emit(w, { type: 'shieldPop', kart: k.id, offroad: true }); }
  let max = off === 2 ? th.offMax : off === 1 ? 105 : base;
  let inTar = false;
  if (!k.air) for (const t of w.tars) if (dhypot(k.x - t.x, k.y - t.y) < t.r) { inTar = true; break; }
  if (k.spin > 0) { k.spin -= dt; inp = NO_INPUT; k.speed *= dpow(0.15, dt); }
  if (k.emp > 0) inp = { ...inp, t: 0, d: false };
  if (k.inv > 0) inp = { ...inp, s: -inp.s * (human ? 1 : 0.6) };
  if (k.boost > 0 && k.emp <= 0) { k.boost -= dt; max = Math.max(max, base * 1.42); if (k.speed < max) k.speed += 320 * dt; }
  if (k.jug > 0) { max = Math.max(max, base * 1.25); if (inp.t > 0 && k.speed < max) k.speed += 150 * dt; }
  if (k.slowT > 0) max *= 0.8;
  if (inTar) { max = Math.min(max, base * 0.45); k.drift = 0; k.dc = 0; inp = { ...inp, d: false }; }
  const tg = k.hookT > 0 ? kartById(w, k.hookTg) : undefined;
  if (k.hookT > 0 && tg) {
    const dd = dhypot(tg.x - k.x, tg.y - k.y);
    max = Math.max(max, base * 1.3);
    if (k.speed < max) k.speed += 220 * dt;
    const da = wrapA(datan2(tg.y - k.y, tg.x - k.x) - k.a);
    if (dd < 260) inp = { ...inp, s: clamp(inp.s + da * 1.5, -1, 1) };
    if (dd < 16) k.hookT = 0;
  }
  k.padT -= dt;
  for (const p of tr.pads)
    if (k.padT <= 0 && dhypot(k.x - p.x, k.y - p.y) < 14) { k.boost = Math.max(k.boost, 0.8); k.padT = 0.5; emit(w, { type: 'pad', kart: k.id }); }
  if (!k.air) {
    if (inp.t > 0) k.speed += 112 * st.acl * dt * (k.speed < 0 ? 3 : 1);
    else if (inp.t < 0) k.speed -= (k.speed > 0 ? 260 : 90) * dt;
    else k.speed -= Math.sign(k.speed) * Math.min(Math.abs(k.speed), 55 * dt);
    if (k.speed > max) k.speed = Math.max(max, k.speed - (off || inTar ? 260 : 200) * dt);
    const ca = dcos(k.a), sa = dsin(k.a), sl = (hAt(tr, k.x + ca * 5, k.y + sa * 5) - hAt(tr, k.x - ca * 5, k.y - sa * 5)) / 10;
    k.speed -= sl * 230 * dt;
  } else {
    // in the air: the Flight stat speeds the kart up or slows it down
    if (k.glide) { const tgt = base * (0.75 + st.fly * 0.055); k.speed += clamp(tgt - k.speed, -60 * dt, 60 * dt); }
    else k.speed += (st.fly - 5) * 5 * dt;
    k.lapFly += dt;
  }
  if (k.speed < -45) k.speed = -45;
  if (inp.d && !k.drift && !k.air && Math.abs(inp.s) > 0.3 && k.speed > 80 && off < 2 && k.spin <= 0) {
    k.drift = Math.sign(inp.s); k.dc = 0; k.hop = 0.14;
    emit(w, { type: 'driftStart', kart: k.id });
  }
  if (k.drift && (!inp.d || k.speed < 60 || off === 2 || k.air)) {
    if (k.dc > 1.5) { k.boost = Math.max(k.boost, 1.0); emit(w, { type: 'miniTurbo', kart: k.id, level: 2 }); }
    else if (k.dc > 0.75) { k.boost = Math.max(k.boost, 0.55); emit(w, { type: 'miniTurbo', kart: k.id, level: 1 }); }
    k.drift = 0; k.dc = 0;
  }
  let steer = inp.s;
  if (k.drift) { steer = k.drift * 0.72 + inp.s * 0.45; k.dc += dt * (Math.sign(inp.s) === k.drift ? 1.3 : 0.8); }
  const sf = clamp(Math.abs(k.speed) / 50, 0, 1) * (k.speed < 0 ? -1 : 1);
  k.a = wrapA(k.a + steer * 2.2 * st.hnd * sf * dt * (k.drift ? 1.15 : 1) * (k.glide ? 0.8 : k.air ? 0.4 : 1));
  if (k.glide) { const j = (k.idx + 14) % N; k.a = wrapA(k.a + wrapA(tr.ang[j]! - k.a) * Math.min(1, 1.3 * dt)); }
  let grip = off === 2 ? 6 : th.grip;
  if (k.air) grip = k.glide ? 2.5 : 0.5;
  const tgtA = k.a - k.drift * 0.28;
  k.va = wrapA(k.va + wrapA(tgtA - k.va) * Math.min(1, grip * dt));
  k.x += dcos(k.va) * k.speed * dt;
  k.y += dsin(k.va) * k.speed * dt;
  if (k.x < 4 || k.y < 4 || k.x > TS - 4 || k.y > TS - 4) {
    if (k.goma > 0) k.speed *= -0.4;
    k.x = clamp(k.x, 4, TS - 4);
    k.y = clamp(k.y, 4, TS - 4);
  }
  const g2 = hAt(tr, k.x, k.y);
  if (k.air) {
    k.vz -= (k.glide ? 68 : 300) * dt;
    k.z += k.vz * dt;
    if (k.z <= g2) { emit(w, { type: 'land', kart: k.id, hard: k.vz < -50 }); k.z = g2; k.air = false; k.glide = false; k.vz = 0; }
  } else {
    const nvz = (g2 - k.z) / Math.max(dt, 1e-3);
    if (nvz < k.vz - 300 * dt - 30 && k.speed > 80) { k.air = true; k.z += k.vz * dt; emit(w, { type: 'jump', kart: k.id }); }
    else { k.vz = lerp(k.vz, nvz, 0.5); k.z = g2; }
  }
  k.hop = Math.max(0, k.hop - dt);
  k.sv = lerp(k.sv, steer, Math.min(1, 10 * dt));
  k.laneT -= dt;
  if (k.prog < prevProg && k.speed > 15) k.backT += dt;
  else k.backT = Math.max(0, k.backT - dt * 2);
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

function updateRace(w: World, inputs: readonly Input[], dt: number) {
  w.raceT += dt;
  const tr = w.track, N = tr.N, Df = DIFFS[w.cfg.diff]!, pp = referenceProg(w);
  const ranked = rankList(w);
  ranked.forEach((k, i) => (k.rank = i));
  w.ranked = ranked.map((k) => k.id);
  for (const k of w.karts)
    if (!isHuman(k)) {
      const df = pp == null ? 0 : k.prog - pp;
      k.rb = k.skill * (df > N * 0.3 ? Df.dn : df < -N * 0.3 ? Df.up : df < -N * 0.1 ? (1 + Df.up) / 2 : 1);
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
  // bumps: the lighter kart is pushed 10% of the kart size × weight difference
  const n = w.karts.length;
  for (let i = 0; i < w.pairCD.length; i++) if (w.pairCD[i]! > 0) w.pairCD[i]! -= dt;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = w.karts[i]!, b = w.karts[j]!;
      if (a.respawn > 0 || b.respawn > 0 || Math.abs(a.z - b.z) > 10) continue;
      const rad = (KSIZE * ((a.jug > 0 ? 2 : 1) + (b.jug > 0 ? 2 : 1))) / 2, dx = b.x - a.x, dy = b.y - a.y, d = dhypot(dx, dy);
      if (d >= rad || d < 0.01) continue;
      const nx = dx / d, ny = dy / d, p = (rad - d) / 2;
      a.x -= nx * p; a.y -= ny * p; b.x += nx * p; b.y += ny * p;
      const key = i * n + j;
      if (w.pairCD[key]! > 0) continue;
      w.pairCD[key] = 0.5;
      if (a.jug > 0 && b.jug <= 0) hit(w, b, 1.5, 3);
      else if (b.jug > 0 && a.jug <= 0) hit(w, a, 1.5, 3);
      const dw = charOf(a).w - charOf(b).w;
      if (Math.abs(dw) > 0.01) {
        const light = dw > 0 ? b : a, s = light === b ? 1 : -1, ex = 0.1 * KSIZE * Math.abs(dw);
        light.x += nx * s * ex; light.y += ny * s * ex; light.speed *= 0.92;
      }
      if (a.goma > 0) { a.x -= nx * 5; a.y -= ny * 5; a.speed *= 0.85; }
      if (b.goma > 0) { b.x += nx * 5; b.y += ny * 5; b.speed *= 0.85; }
      emit(w, { type: 'bump', a: a.id, b: b.id });
    }
  // item boxes
  tr.boxes.forEach((b, bi) => {
    const bs = w.boxes[bi]!;
    if (!bs.active) { bs.t -= dt; if (bs.t <= 0) bs.active = true; return; }
    for (const k of w.karts) {
      if (k.respawn <= 0 && dhypot(k.x - b.x, k.y - b.y) < 11 && Math.abs(k.z - b.z) < 14) {
        bs.active = false; bs.t = 3;
        if (!k.item && k.roll <= 0) {
          if (isHuman(k)) { k.roll = 1.0; emit(w, { type: 'itemRoll', kart: k.id }); }
          else giveItem(w, k, rollItem(w, k, charOf(k).luck));
        }
        break;
      }
    }
  });
  // fake oil stains only smudge humans' screens (legacy behavior)
  for (const f of w.fakes) {
    f.age += dt; f.cdn -= dt;
    for (const k of w.karts) {
      if (!isHuman(k) || k.air || f.cdn > 0) continue;
      if (dhypot(k.x - f.x, k.y - f.y) < 11 && !(f.owner === k.id && f.age < 1)) { k.smudge = 1; f.cdn = 1.5; emit(w, { type: 'smudge', kart: k.id }); }
    }
  }
  w.fakes = w.fakes.filter((f) => f.age < 25);
  for (const t of w.tars) t.life -= dt;
  w.tars = w.tars.filter((t) => t.life > 0);
  for (const s of w.shots) {
    s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z = hAt(tr, s.x, s.y) + 3;
    if (dgAt(tr, s.x, s.y) > ROAD + 14) { s.life = 0; continue; }
    for (const k of w.karts) {
      if (k.id === s.owner) continue;
      if (dhypot(k.x - s.x, k.y - s.y) < 10) { hit(w, k, 1.0, 1); s.life = 0; break; }
    }
  }
  w.shots = w.shots.filter((s) => s.life > 0);
  for (const r of w.rockets) {
    r.life -= dt; r.t += dt; r.s += 45 * dt;
    const i0 = Math.floor(r.s), f = r.s - i0, a = ((i0 % N) + N) % N, b = (a + 1) % N;
    const tgt = kartById(w, r.target);
    if (tgt && !tgt.finished) {
      const at = tr.ang[tgt.idx]!, lt = (tgt.x - tr.x[tgt.idx]!) * -dsin(at) + (tgt.y - tr.y[tgt.idx]!) * dcos(at);
      r.lat = lerp(r.lat, lt, Math.min(1, 3 * dt));
    } else r.lat *= dpow(0.4, dt);
    const an = tr.ang[a]!;
    r.x = lerp(tr.x[a]!, tr.x[b]!, f) - dsin(an) * r.lat;
    r.y = lerp(tr.y[a]!, tr.y[b]!, f) + dcos(an) * r.lat;
    r.z = hAt(tr, r.x, r.y) + 8;
    for (const k of w.karts) {
      if (k.id === r.owner) continue;
      if (dhypot(k.x - r.x, k.y - r.y) < 11) { hit(w, k, 1.1, 1); r.life = 0; break; }
    }
  }
  w.rockets = w.rockets.filter((r) => r.life > 0);
  for (const h of w.holes) h.t += dt;
  w.holes = w.holes.filter((h) => h.t < 1);
  // end of race: 3 s after every human (or every kart, if there are none) finished
  if (w.phase === 'race') {
    const humans = w.karts.filter(isHuman), watch = humans.length ? humans : w.karts;
    if (w.finishDelay <= 0 && watch.every((k) => k.finished)) w.finishDelay = 3;
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
    for (const k of w.karts) if (isHuman(k)) { if (quantizeInput(inputs[k.id]).t > 0) k.held += dt; else k.held = 0; }
    const n = Math.ceil(w.cd);
    if (n < w.cdLast && n > 0) { w.cdLast = n; emit(w, { type: 'countdown', n }); }
    if (w.cd <= 0) {
      w.phase = 'race';
      emit(w, { type: 'go' });
      for (const k of w.karts)
        if (isHuman(k) && k.held > 0 && k.held < 1.1) { k.boost = 0.9; k.speed = 90; emit(w, { type: 'rocketStart', kart: k.id }); }
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
