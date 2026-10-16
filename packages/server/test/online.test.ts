// Phase 11: online rooms with codes, isolation between rooms, the server never trusts client input, limits.
import { expect, test } from 'bun:test';
import { PROTOCOL_VERSION, handshakeTunables, type ServerMsg } from '@jpkart/core';
import { createOnline, ONLINE_LIMITS } from '../src/online';
import type { Conn } from '../src/room';

function setup() {
  const on = createOnline(() => {});
  let id = 1;
  const client = () => {
    const got: ServerMsg[] = [];
    const conn: Conn = { id: id++, send: (m) => got.push(m), close() {} };
    const say = (m: unknown) => on.onMessage(conn, JSON.stringify(m));
    return { conn, got, say, last: <T extends ServerMsg['t']>(t: T) => got.filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined };
  };
  const hello = { t: 'hello', proto: PROTOCOL_VERSION, tun: handshakeTunables() };
  return { on, client, hello };
}

test('online: crear sala da un código; unirse con él entra en la misma sala; un código malo se rechaza', () => {
  const { on, client, hello } = setup();
  const a = client(), b = client(), c = client();
  a.say({ ...hello, name: 'Ana', create: true });
  const code = a.last('welcome')!.room!;
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
  b.say({ ...hello, name: 'Beto', room: code.toLowerCase() }); // codes are case-insensitive
  expect(b.last('welcome')!.room).toBe(code);
  expect(b.last('lobby')!.players.map((p) => p.name)).toEqual(['Ana', 'Beto']);
  c.say({ ...hello, name: 'Cris', room: 'ZZZZZ' });
  expect(c.last('reject')!.reason).toContain('No existe la sala');
  expect(on.rooms.size).toBe(1);
}, 60000);

test('online: las salas están aisladas y una sala vacía se cierra', () => {
  const { on, client, hello } = setup();
  const a = client(), b = client();
  a.say({ ...hello, name: 'A', create: true });
  b.say({ ...hello, name: 'B', create: true });
  expect(on.rooms.size).toBe(2);
  expect(a.last('lobby')!.players.length).toBe(1);
  expect(b.last('lobby')!.players.length).toBe(1);
  a.say({ t: 'start' });
  for (let i = 0; i < 120; i++) on.tick();
  const [ra, rb] = [...on.rooms.values()];
  expect(ra!.phase).toBe('race');
  expect(rb!.phase).toBe('lobby'); // B's room did not start
  on.onClose(a.conn);
  expect(on.rooms.size).toBe(1);
}, 60000);

test('online: el servidor no confía en el cliente (inputs inválidos, nombres, ajustes)', () => {
  const { on, client, hello } = setup();
  const a = client();
  a.say({ ...hello, name: '<b>\u0007Juan Pablo Kart</b>', create: true });
  expect(a.last('lobby')!.players[0]!.name).toBe('bJuan Pablo');
  a.say({ t: 'settings', s: { mode: 'free', trackIndex: 'x', cup: 0, diff: 1, laps: 3 } });
  a.say({ t: 'settings', s: { mode: 'hack', trackIndex: 18, cup: 0, diff: 1, laps: 3 } });
  const room = [...on.rooms.values()][0]!;
  expect(room.settings).toMatchObject({ mode: 'cup', trackIndex: 17 }); // both rejected: still the defaults
  a.say({ t: 'start' });
  on.tick();
  const p = room.players.get(a.conn.id)!;
  a.say({ t: 'in', i: [[1, NaN, 0, 0, 0], [2, 9999, 0, 0, 0], [3, 127, 0, 2, 0], 'x', [4, 1.5, 0, 0, 0]] });
  expect(p.queue.length).toBe(0);
  a.say({ t: 'in', i: [[5, 127, -64, 1, 0]] });
  expect(p.queue.length).toBe(1);
  for (let i = 0; i < 30; i++) on.tick();
  expect(room.world!.karts.every((k) => Number.isFinite(k.x) && Number.isFinite(k.speed))).toBe(true);
}, 60000);

test('online: límite de mensajes por segundo y mensajes basura', () => {
  const { on, client, hello } = setup();
  const a = client();
  a.say({ ...hello, name: 'A', create: true });
  const room = [...on.rooms.values()][0]!;
  a.say({ t: 'start' });
  on.tick();
  const p = room.players.get(a.conn.id)!;
  for (let i = 0; i < 1000; i++) a.say({ t: 'in', i: [[10 + i, 127, 0, 0, 0]] });
  expect(p.queue.length).toBeLessThanOrEqual(6); // the queue cap still holds
  expect(p.queue.at(-1)![0]).toBeLessThan(10 + ONLINE_LIMITS.msgsPerSec); // messages past the limit were dropped
  on.onMessage(a.conn, '{no es json');
  on.onMessage(a.conn, '42');
  on.onMessage(a.conn, JSON.stringify({ t: 'pick', ch: 'x' }));
  expect(room.players.size).toBe(1);
}, 60000);

test('web: sirve el cliente, cae a index.html y no sale de la carpeta', async () => {
  const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { webHandler } = await import('../src/online');
  const dir = mkdtempSync(join(tmpdir(), 'jpkart-web-'));
  writeFileSync(join(dir, 'index.html'), '<h1>jp</h1>');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'a.js'), 'x');
  const h = webHandler(dir);
  const call = (url: string, method = 'GET') => {
    const out = { status: 0, headers: {} as Record<string, unknown>, body: '' };
    const res = { writeHead: (s: number, hd: Record<string, unknown>) => { out.status = s; out.headers = hd; }, end: (b?: unknown) => { out.body = String(b ?? ''); } };
    const handled = h({ url, method } as never, res as never);
    return { handled, ...out };
  };
  expect(call('/')).toMatchObject({ handled: true, status: 200, body: '<h1>jp</h1>' });
  expect(call('/sala/ABCDE').body).toBe('<h1>jp</h1>'); // SPA fallback
  expect(call('/assets/a.js').headers['content-type']).toContain('javascript');
  expect(call('/%2e%2e/%2e%2e/package.json').handled).toBe(false); // traversal is not served
  expect(call('/', 'POST').handled).toBe(false);
  expect(webHandler(undefined)({ url: '/', method: 'GET' } as never, {} as never)).toBe(false); // no WEB_DIR: only /health and WS
});
