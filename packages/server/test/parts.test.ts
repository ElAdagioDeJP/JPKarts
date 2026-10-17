// V3-3: protocolo 7 — el kart (personaje + piezas) se elige en el lobby, el servidor lo valida y aplica el límite de 30 s.
import { expect, test } from 'bun:test';
import { CHARS, DEFAULT_LOADOUT, PROTOCOL_VERSION, T, handshakeTunables, kartStats, validLoadout, type Loadout, type ServerMsg } from '@jpkart/core';
import { Room, type Conn } from '../src/room';

function join(room: Room, n: number) {
  const got: ServerMsg[][] = [];
  const conns: Conn[] = [];
  for (let i = 0; i < n; i++) {
    got.push([]);
    const c: Conn = { id: i + 1, close() {}, send: (m: ServerMsg) => { got[i]!.push(m); } };
    conns.push(c);
    room.onMessage(c, { t: 'hello', proto: PROTOCOL_VERSION, name: 'J' + i, tun: handshakeTunables() });
  }
  return { conns, got };
}
const ticks = (room: Room, s: number) => { for (let i = 0; i < Math.round(s * 60); i++) room.tick(); };
const lastLobby = (got: ServerMsg[]) => [...got].reverse().find((m) => m.t === 'lobby') as Extract<ServerMsg, { t: 'lobby' }>;
const MINE: Loadout = { body: 'overdrive', wheels: 'mini', wing: 'glider' };

test('el protocolo es el 7', () => {
  expect(PROTOCOL_VERSION).toBe(7);
});

test('pick con piezas válidas: se guardan y salen en el lobby de todos', () => {
  const room = new Room(1);
  const { conns, got } = join(room, 2);
  room.onMessage(conns[1]!, { t: 'pick', ch: 5, parts: MINE });
  const p = lastLobby(got[0]!).players.find((q) => q.id === 2)!;
  expect(p.ch).toBe(5);
  expect(p.parts).toEqual(MINE);
  expect(lastLobby(got[0]!).players.find((q) => q.id === 1)!.parts).toEqual(DEFAULT_LOADOUT); // quien no eligió, el kart por defecto
});

test('pick con piezas inválidas se rechaza entero (ni personaje ni piezas cambian)', () => {
  const room = new Room(2);
  const { conns } = join(room, 2);
  const before = { ...room.players.get(2)! };
  const bad: unknown[] = [
    { body: 'nope', wheels: 'std', wing: 'wing' },
    { body: 'std', wheels: 'kernel', wing: 'wing' },
    { body: 'kernel', wheels: 'std' },
    { body: 'kernel', wheels: 'std', wing: 'wing', extra: 'x' },
    'kernel', 7, null, [],
  ];
  for (const parts of bad) room.onMessage(conns[1]!, { t: 'pick', ch: 7, parts } as never);
  const q = room.players.get(2)!;
  expect(q.ch).toBe(before.ch);
  expect(q.parts).toEqual(before.parts);
});

test('personaje único por sala, piezas repetibles', () => {
  const room = new Room(3);
  const { conns } = join(room, 3);
  room.onMessage(conns[0]!, { t: 'pick', ch: 4, parts: MINE });
  room.onMessage(conns[1]!, { t: 'pick', ch: 4, parts: MINE }); // el mismo personaje: se ignora
  expect(room.players.get(2)!.ch).not.toBe(4);
  room.onMessage(conns[1]!, { t: 'pick', ch: 6, parts: MINE }); // las mismas piezas: sí
  expect(room.players.get(2)!.parts).toEqual(MINE);
  expect(room.players.get(1)!.parts).toEqual(MINE);
});

test('todos listos: arranca ya, y la parrilla lleva las piezas de cada humano', () => {
  const room = new Room(4);
  const { conns } = join(room, 2);
  room.onMessage(conns[0]!, { t: 'pick', ch: 5, parts: MINE });
  room.onMessage(conns[1]!, { t: 'pick', ch: 1, parts: { body: 'rover', wheels: 'offroad', wing: 'light' } });
  room.onMessage(conns[1]!, { t: 'ready', ready: true });
  room.onMessage(conns[0]!, { t: 'start' });
  expect(room.phase).toBe('race');
  const w = room.world!;
  const k0 = w.karts.find((k) => k.ch === 5)!, k1 = w.karts.find((k) => k.ch === 1)!;
  expect(w.cfg.grid.find((g) => g.ch === 5)!.parts).toEqual(MINE);
  expect(k0.st.spd).toBeCloseTo(kartStats(5, MINE).spd, 9);
  expect(k1.st.fly).toBeCloseTo(kartStats(1, { body: 'rover', wheels: 'offroad', wing: 'light' }).fly, 9);
  // las IA llevan el kart por defecto
  const ai = w.karts.find((k) => k.ctrl === 'ai')!;
  expect(ai.st.spd).toBeCloseTo(CHARS[ai.ch]!.spd, 9);
});

test('límite de 30 s: quien no confirma recibe piezas aleatorias válidas; quien confirmó, las suyas', () => {
  const room = new Room(5);
  const { conns, got } = join(room, 3);
  room.onMessage(conns[1]!, { t: 'pick', ch: 9, parts: MINE });
  room.onMessage(conns[1]!, { t: 'ready', ready: true });
  // el 3.º no confirma nunca
  room.onMessage(conns[0]!, { t: 'start' });
  expect(room.phase).toBe('lobby'); // espera a los que no han confirmado
  expect(lastLobby(got[1]!).pickIn).toBe(T.race.pickTime);
  ticks(room, T.race.pickTime - 2);
  expect(room.phase).toBe('lobby');
  expect(lastLobby(got[1]!).pickIn).toBeLessThanOrEqual(3);
  ticks(room, 3);
  expect(room.phase).toBe('race');
  const mine = room.players.get(2)!, idle = room.players.get(3)!;
  expect(mine.parts).toEqual(MINE);
  expect(validLoadout(idle.parts)).toBe(true);
  expect(room.world!.cfg.grid.find((g) => g.ch === idle.ch)!.parts).toEqual(idle.parts);
});

test('si todos confirman durante la cuenta atrás, arranca sin esperar a los 30 s', () => {
  const room = new Room(6);
  const { conns } = join(room, 2);
  room.onMessage(conns[0]!, { t: 'start' });
  expect(room.phase).toBe('lobby');
  ticks(room, 5);
  room.onMessage(conns[1]!, { t: 'ready', ready: true });
  expect(room.phase).toBe('race');
});

test('cambiar los ajustes cancela la cuenta atrás', () => {
  const room = new Room(7);
  const { conns, got } = join(room, 2);
  room.onMessage(conns[0]!, { t: 'start' });
  expect(lastLobby(got[0]!).pickIn).toBe(T.race.pickTime);
  room.onMessage(conns[0]!, { t: 'settings', s: { ...room.settings, diff: 2 } });
  expect(lastLobby(got[0]!).pickIn).toBeUndefined();
  ticks(room, T.race.pickTime + 2);
  expect(room.phase).toBe('lobby');
});

test('12 humanos: cada uno con su kart, 30 s para todos, y la carrera sale con 12 karts remotos', () => {
  const room = new Room(8);
  const { conns } = join(room, 12);
  conns.forEach((c, i) => room.onMessage(c, { t: 'pick', ch: i, parts: i % 2 ? MINE : DEFAULT_LOADOUT }));
  room.onMessage(conns[0]!, { t: 'start' });
  ticks(room, T.race.pickTime + 1);
  expect(room.phase).toBe('race');
  expect(room.world!.karts.length).toBe(12);
  expect(room.world!.karts.every((k) => k.ctrl === 'remote')).toBe(true);
  expect(validLoadout(room.world!.cfg.grid[0]!.parts)).toBe(true);
});
