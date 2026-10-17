import { expect, test } from 'bun:test';
import { CHARS, CUPS, PROTOCOL_VERSION, T, handshakeTunables, type ServerMsg } from '@jpkart/core';
import { Room, type Conn } from '../src/room';

function setup() {
  const room = new Room(77);
  const got: ServerMsg[][] = [[], []];
  const conns: Conn[] = [0, 1].map((i) => ({ id: i + 1, close() {}, send: (m: ServerMsg) => { got[i]!.push(m); } }));
  conns.forEach((c, i) => room.onMessage(c, { t: 'hello', proto: PROTOCOL_VERSION, name: 'J' + i, tun: handshakeTunables() }));
  room.onMessage(conns[1]!, { t: 'ready', ready: true });
  return { room, conns, got };
}
/** the clients build the track and report it: the countdown can start */
const load = (room: Room, conns: Conn[]) => { for (const c of conns) room.onMessage(c, { t: 'loaded', rid: room.rid }); };
const ticks = (room: Room, s: number) => { for (let i = 0; i < Math.round(s * 60); i++) room.tick(); };

// V3-1 sustituye la "velocidad única" por la regla de Mario: los pesados tienen más punta (docs/V3_PLAN.md §1)
test('la velocidad punta sale del stat: pesado > medio > ligero', () => {
  const spd = (n: string) => CHARS.find((c) => c.name === n)!.spd;
  expect(spd('Luis')).toBeGreaterThan(spd('Guaycaipuro'));
  expect(spd('Guaycaipuro')).toBeGreaterThan(spd('Marco'));
});

test('copa por defecto en la sala', () => {
  expect(setup().room.settings.mode).toBe('cup');
}, 120_000);

test('el primero cruza la meta: a los 30 s se acaba la carrera, y la siguiente de la copa arranca sola', () => {
  const { room, conns, got } = setup();
  room.onMessage(conns[0]!, { t: 'start' });
  expect(room.phase).toBe('race');
  load(room, conns);
  expect(room.world!.cfg.lastCall).toBe(true);
  ticks(room, T.race.countdown + 1); // salida
  const human = room.world!.karts.find((k) => k.ctrl === 'remote')!;
  human.finished = true; human.time = 40;
  ticks(room, 1);
  expect(room.world!.lastCall).toBeGreaterThan(0);
  expect(room.phase).toBe('race');
  ticks(room, T.race.finishTimeout - 2);
  expect(room.phase).toBe('race'); // todavía hay tiempo
  ticks(room, 2 + T.race.finishDelay + 0.5);
  expect(room.phase).toBe('standings');
  const end = got[0]!.find((m) => m.t === 'end');
  expect(end).toBeTruthy();
  const lobby = got[0]!.filter((m) => m.t === 'lobby').at(-1)!;
  expect(lobby.t === 'lobby' && lobby.nextIn).toBeGreaterThan(0);
  // sin que nadie pulse nada
  ticks(room, T.race.nextRaceDelay + 0.5);
  expect(room.phase).toBe('race');
  load(room, conns);
  expect(room.cupRace).toBe(1);
  expect(got[0]!.filter((m) => m.t === 'start').length).toBe(2);
}, 120_000);

test('tras la última carrera de la copa se vuelve al lobby solo', () => {
  const { room, conns } = setup();
  room.onMessage(conns[0]!, { t: 'start' });
  load(room, conns);
  room.cupRace = CUPS[0]!.tracks.length - 1;
  ticks(room, T.race.countdown + 1);
  const human = room.world!.karts.find((k) => k.ctrl === 'remote')!;
  human.finished = true; human.time = 40;
  ticks(room, T.race.finishTimeout + T.race.finishDelay + 1);
  expect(room.phase).toBe('standings');
  ticks(room, T.race.nextRaceDelay + 0.5);
  expect(room.phase).toBe('lobby');
}, 120_000);
