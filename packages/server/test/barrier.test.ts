import { expect, test } from 'bun:test';
import { PROTOCOL_VERSION, T, handshakeTunables, type ServerMsg } from '@jpkart/core';
import { Room, type Conn } from '../src/room';

const hello = (name: string, pid?: string) => ({ t: 'hello' as const, proto: PROTOCOL_VERSION, name, tun: handshakeTunables(), ...(pid ? { pid } : {}) });
function setup() {
  const room = new Room(5);
  const got: ServerMsg[][] = [[], [], []];
  const mk = (i: number): Conn => ({ id: i + 1, close() {}, send: (m: ServerMsg) => { got[i]!.push(m); } });
  const conns = [mk(0), mk(1)];
  room.onMessage(conns[0]!, hello('Ana', 'pid-ana-0001'));
  room.onMessage(conns[1]!, hello('Beto', 'pid-beto-0002'));
  room.onMessage(conns[1]!, { t: 'ready', ready: true });
  room.onMessage(conns[0]!, { t: 'start' });
  return { room, conns, got, mk };
}
const ticks = (room: Room, s: number) => { for (let i = 0; i < Math.round(s * 60); i++) room.tick(); };

test('barrera de salida: la cuenta atrás no corre hasta que todos los humanos cargaron', () => {
  const { room, conns, got } = setup();
  expect(got[0]!.find((m) => m.t === 'start')).toMatchObject({ rid: 1 });
  ticks(room, 5);
  expect(room.world!.tick).toBe(0); // nadie cargó: el mundo no avanza
  room.onMessage(conns[0]!, { t: 'loaded', rid: room.rid });
  ticks(room, 5);
  expect(room.world!.tick).toBe(0); // falta Beto
  const wait = got[0]!.filter((m) => m.t === 'lobby').at(-1)!;
  expect(wait.t === 'lobby' && wait.loading).toEqual({ done: 1, total: 2 });
  room.onMessage(conns[1]!, { t: 'loaded', rid: room.rid - 1 }); // de otra carrera: no cuenta
  ticks(room, 1);
  expect(room.world!.tick).toBe(0);
  room.onMessage(conns[1]!, { t: 'loaded', rid: room.rid });
  ticks(room, 1);
  expect(room.world!.tick).toBeGreaterThan(50);
  expect(got[0]!.some((m) => m.t === 'go' && m.rid === 1)).toBe(true);
  expect(got[1]!.some((m) => m.t === 'go')).toBe(true);
}, 120_000);

test('los inputs que llegan antes del «go» se descartan', () => {
  const { room, conns } = setup();
  room.onMessage(conns[0]!, { t: 'in', i: [[1, 127, 0, 0, 0]] });
  room.onMessage(conns[0]!, { t: 'loaded', rid: room.rid });
  room.onMessage(conns[1]!, { t: 'loaded', rid: room.rid });
  ticks(room, 0.1);
  const p = [...room.players.values()][0]!;
  expect(p.queue.length + (p.last[0] > 0 ? 1 : 0)).toBe(0);
}, 120_000);

test('si un cliente no carga en el tiempo límite, su kart pasa a la IA y la carrera empieza', () => {
  const { room, conns, got } = setup();
  room.onMessage(conns[0]!, { t: 'loaded', rid: room.rid });
  ticks(room, T.race.loadTimeout + 0.5);
  expect(room.world!.tick).toBeGreaterThan(0);
  const slow = room.world!.karts.find((k) => k.ctrl === 'ai' && [...room.players.values()].some((p) => p.name === 'Beto' && p.kart === k.id));
  expect(slow).toBeTruthy();
  expect(got[0]!.some((m) => m.t === 'go')).toBe(true);
}, 120_000);

test('un jugador que se cae a mitad de carrera vuelve a su kart con su perfil', () => {
  const { room, conns, got, mk } = setup();
  for (const c of conns) room.onMessage(c, { t: 'loaded', rid: room.rid });
  ticks(room, 6);
  const kartId = [...room.players.values()].find((p) => p.name === 'Beto')!.kart;
  room.leave(conns[1]!.id); // se cae
  expect(room.world!.karts[kartId]!.ctrl).toBe('ai');
  ticks(room, 2);
  // vuelve con otra conexión y el mismo perfil
  const back = mk(2);
  room.onMessage(back, hello('Beto', 'pid-beto-0002'));
  expect(room.world!.karts[kartId]!.ctrl).toBe('remote');
  const start = got[2]!.find((m) => m.t === 'start');
  expect(start).toMatchObject({ t: 'start', kart: kartId, resume: true, rid: room.rid });
  ticks(room, 0.1);
  const snap = got[2]!.find((m) => m.t === 'snap');
  expect(snap && snap.t === 'snap' && !!snap.state).toBe(true); // snapshot entero, sin delta
  // otro perfil no puede colarse en la carrera
  const other = mk(0);
  room.onMessage(other, hello('Intruso', 'pid-otro-9999'));
  expect(got[0]!.some((m) => m.t === 'reject')).toBe(true);
}, 120_000);

test('la misma conexión vieja (medio muerta) se reemplaza al volver con el mismo perfil', () => {
  const { room, conns, got, mk } = setup();
  for (const c of conns) room.onMessage(c, { t: 'loaded', rid: room.rid });
  ticks(room, 3);
  const back = mk(2);
  room.onMessage(back, hello('Beto', 'pid-beto-0002')); // el servidor aún cree que la vieja sigue viva
  expect(got[2]!.find((m) => m.t === 'start')).toBeTruthy();
  expect([...room.players.values()].filter((p) => p.name === 'Beto').length).toBe(1);
}, 120_000);
