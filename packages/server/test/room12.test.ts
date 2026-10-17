// V3-2: hasta 12 humanos por sala, un personaje distinto para cada uno.
import { expect, test } from 'bun:test';
import { CHARS, PROTOCOL_VERSION, handshakeTunables, type ServerMsg } from '@jpkart/core';
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

test('12 humanos entran con personajes distintos y el 13.º es rechazado', () => {
  const room = new Room(5);
  const { conns, got } = join(room, 13);
  expect(room.players.size).toBe(12);
  expect(new Set([...room.players.values()].map((p) => p.ch)).size).toBe(12);
  expect(got[12]!.some((m) => m.t === 'reject')).toBe(true);
});

test('pick: acepta los 12 personajes, rechaza el 12 y el repetido', () => {
  const room = new Room(6);
  const { conns } = join(room, 2);
  const taken = room.players.get(1)!.ch;
  room.onMessage(conns[1]!, { t: 'pick', ch: taken }); // el de otro: se ignora
  expect(room.players.get(2)!.ch).not.toBe(taken);
  room.onMessage(conns[1]!, { t: 'pick', ch: CHARS.length }); // fuera de rango
  expect(room.players.get(2)!.ch).toBeLessThan(CHARS.length);
  room.onMessage(conns[1]!, { t: 'pick', ch: CHARS.length - 1 });
  expect(room.players.get(2)!.ch).toBe(CHARS.length - 1);
});

test('con 12 humanos la parrilla tiene 12 karts y ninguna IA', () => {
  const room = new Room(7);
  const { conns } = join(room, 12);
  for (const c of conns.slice(1)) room.onMessage(c, { t: 'ready', ready: true });
  room.onMessage(conns[0]!, { t: 'start' });
  expect(room.phase).toBe('race');
  expect(room.world!.karts.length).toBe(12);
  expect(room.world!.karts.every((k) => k.ctrl === 'remote')).toBe(true);
});
