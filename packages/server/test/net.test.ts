import { expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import {
  ALL_TRACKS, PROTOCOL_VERSION, PredictedRace, TrackCache, datan2, dcos, dsin, handshakeTunables, hashWorld, playReplay, prepAuthored, wrapA,
  type ClientMsg, type Input, type LobbySettings, type ServerMsg, type World,
} from '@jpkart/core';

/** A decent human stand-in: pure pursuit on the racing line. Reads the world, never touches it (no RNG). */
function pilot(w: World, id: number, f: number): Input {
  const k = w.karts[id]!, tr = w.track, line = tr.line!, i = (k.idx + 10 + Math.round(Math.max(0, k.speed) / 18)) % tr.N;
  const a = tr.ang[i]!, off = line.off[i]!, tx = tr.x[i]! - dsin(a) * off, ty = tr.y[i]! + dcos(a) * off;
  const da = wrapA(datan2(ty - k.y, tx - k.x) - k.a);
  return { t: Math.abs(da) > 1 ? 0.4 : 1, s: Math.max(-1, Math.min(1, da * 2.6)), d: false, item: f % 300 === 0 };
}
import { Room, type Conn } from '../src/room';

/**
 * In-memory network with one-way latency and occasional extra delay ("loss" over TCP = late delivery).
 * Like TCP, each channel delivers in order: a late message holds back the ones sent after it (head-of-line blocking).
 */
class Net {
  now = 0;
  private q: { at: number; seq: number; fn: () => void }[] = [];
  private last = new Map<string, number>();
  private seq = 0;
  constructor(public latency: number, public lossRate: number, private rand: () => number) {}
  send(ch: string, fn: () => void) {
    const extra = this.rand() < this.lossRate ? 0.12 : 0;
    const at = Math.max(this.now + this.latency + extra, this.last.get(ch) ?? 0);
    this.last.set(ch, at);
    this.q.push({ at, seq: this.seq++, fn });
  }
  flush() {
    const due = this.q.filter((m) => m.at <= this.now).sort((a, b) => a.at - b.at || a.seq - b.seq);
    this.q = this.q.filter((m) => m.at > this.now);
    for (const m of due) m.fn();
  }
}

function lcg(seed: number) { let s = seed; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

function runNetworkRace(latency: number, loss: number, seconds: number, extra: Partial<LobbySettings> = {}) {
  const net = new Net(latency, loss, lcg(42));
  const room = new Room(1234);
  const tracks = new TrackCache(ALL_TRACKS, prepAuthored);
  const clients = [1, 2].map((id) => ({ id, race: null as PredictedRace | null, bytes: 0, gz: 0, rejected: '' }));
  const conns: Conn[] = clients.map((c) => ({
    id: c.id,
    close() {},
    send(m: ServerMsg) {
      const s = JSON.stringify(m);
      c.bytes += s.length;
      if (m.t === 'snap') c.gz += gzipSync(s).length;
      net.send('s' + c.id, () => {
        if (m.t === 'reject') c.rejected = m.reason;
        if (m.t === 'start') c.race = new PredictedRace(m.cfg, tracks.ensureBuilt(m.cfg.trackIndex, [], !!m.cfg.mirror), m.kart);
        if (m.t === 'snap') c.race?.onSnapshot(m);
      });
    },
  }));
  const toServer = (i: number, m: ClientMsg) => net.send('c' + i, () => room.onMessage(conns[i]!, m));
  conns.forEach((_, i) => toServer(i, { t: 'hello', proto: PROTOCOL_VERSION, name: 'J' + i, tun: handshakeTunables() }));
  net.now += 0.5; net.flush(); net.now += 0.5; net.flush();
  toServer(1, { t: 'pick', ch: 3 });
  toServer(1, { t: 'ready', ready: true });
  toServer(0, { t: 'settings', s: { mode: 'free', trackIndex: 16, cup: 0, diff: 1, laps: 3, ...extra } });
  net.now += 0.5; net.flush();
  toServer(0, { t: 'start' });
  net.now += 0.5; net.flush(); net.now += 0.5; net.flush();
  const dt = 1 / 60;
  for (let f = 0; f < seconds * 60; f++) {
    net.now += dt;
    net.flush();
    clients.forEach((c, i) => {
      if (!c.race) return;
      const { packed } = c.race.tick(pilot(c.race.world, c.race.kart, f + i * 37));
      toServer(i, { t: 'in', i: [packed] });
    });
    room.tick();
  }
  return { room, clients };
}

test('red: 2 clientes, 80 ms y 2 % de pérdida — estado del servidor = replay; predicción y ancho de banda acotados', () => {
  const secs = 40;
  const { room, clients } = runNetworkRace(0.08, 0.02, secs);
  expect(clients.every((c) => !c.rejected && c.race)).toBe(true);
  // the authoritative world is exactly its recorded replay (determinism end to end)
  const w = room.world!, rep = room.recorder!.replay;
  const tr = room.tracks.ensureBuilt(w.cfg.trackIndex);
  const { world, mismatch } = playReplay(JSON.parse(JSON.stringify(rep)), tr);
  expect(mismatch).toBe(-1);
  expect(hashWorld(world)).toBe(hashWorld(w));
  // clients really drove: their karts moved forward
  for (const c of clients) expect(w.karts[c.race!.kart]!.prog).toBeGreaterThan(50);
  const kbps = clients.map((c) => c.gz / secs / 1024);
  const corr = clients.flatMap((c) => c.race!.corrections).sort((a, b) => a - b);
  const p95 = corr[Math.floor(corr.length * 0.95)] ?? 0;
  console.log(`correcciones p95 ${p95.toFixed(2)} u · ancho de banda (comprimido) ${kbps.map((k) => k.toFixed(1)).join(' / ')} KB/s por cliente`);
  expect(p95).toBeLessThan(25);
}, 120000);

test('red: con 50 ms de latencia la corrección del kart local es < 5 u en el p95', () => {
  const { clients } = runNetworkRace(0.05, 0, 30);
  const corr = clients.flatMap((c) => c.race!.corrections).sort((a, b) => a - b);
  const p95 = corr[Math.floor(corr.length * 0.95)] ?? 0;
  console.log(`50 ms: correcciones p95 ${p95.toFixed(2)} u`);
  expect(p95).toBeLessThan(5);
}, 120000);

test('red: versión de protocolo o tunables distintos → rechazo con mensaje en español', () => {
  const room = new Room(1);
  const got: ServerMsg[] = [];
  const conn: Conn = { id: 9, close() {}, send: (m) => got.push(m) };
  room.onMessage(conn, { t: 'hello', proto: PROTOCOL_VERSION + 1, name: 'X', tun: handshakeTunables() });
  room.onMessage(conn, { t: 'hello', proto: PROTOCOL_VERSION, name: 'X', tun: 'deadbeef' });
  expect(got.map((m) => m.t)).toEqual(['reject', 'reject']);
  expect((got[0] as { reason: string }).reason).toContain('Versión');
});

/** Phase 9 modes over the network: the authoritative world must still equal its replay, on the right track. */
function modeSmoke(extra: Partial<LobbySettings>) {
  const { room, clients } = runNetworkRace(0.06, 0.02, 25, extra);
  expect(clients.every((c) => !c.rejected && c.race)).toBe(true);
  const w = room.world!, rep = room.recorder!.replay;
  const tr = room.tracks.ensureBuilt(w.cfg.trackIndex, [], !!w.cfg.mirror);
  // the clients predict on the same (mirrored or not) track as the server
  for (const c of clients) expect(c.race!.world.track).toBe(clients[0]!.race!.world.track);
  const { world, mismatch } = playReplay(JSON.parse(JSON.stringify(rep)), tr);
  expect(mismatch).toBe(-1);
  expect(hashWorld(world)).toBe(hashWorld(w));
  for (const c of clients) expect(w.karts[c.race!.kart]!.prog).toBeGreaterThan(40);
  return w;
}

test('red: Eliminación en Espejo — servidor = replay y pista reflejada en todos', () => {
  const w = modeSmoke({ mode: 'elimination', cls: 'espejo', trackIndex: 17 });
  expect(w.cfg.mode).toBe('elimination');
  expect(w.cfg.laps).toBe(7);
  expect(w.cfg.mirror).toBe(true);
}, 120000);

test('red: Equipos a 150cc — servidor = replay', () => {
  const w = modeSmoke({ teams: true, cls: '150', trackIndex: 24 });
  expect(w.cfg.teams).toBe(true);
  expect(w.karts.every((k) => k.team === 0 || k.team === 1)).toBe(true);
  expect(w.cfg.cc).toBe(150);
}, 120000);
