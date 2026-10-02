// Phase 11 check against a running online server (the Docker image or `bun packages/server/src/online.ts`):
// /health answers, one client creates a room, another joins with the code, a wrong code is rejected.
// Usage: bun tools/online-check.mjs [ws://host:port | wss://dominio]
import { PROTOCOL_VERSION, handshakeTunables } from '../packages/core/src/index.ts';
const base = process.argv[2] ?? 'ws://localhost:7777';
const httpBase = base.replace(/^ws/, 'http');

const health = await fetch(httpBase + '/health').then((r) => r.text()).catch((e) => 'ERROR ' + e.message);
const open = (hello) => new Promise((resolve) => {
  const ws = new WebSocket(base), got = [];
  ws.onopen = () => ws.send(JSON.stringify(hello));
  ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); got.push(m); if (m.t === 'lobby' || m.t === 'reject') resolve({ ws, got, m }); };
  ws.onerror = () => resolve({ ws, got, m: { t: 'error' } });
});
const proto = PROTOCOL_VERSION, tun = handshakeTunables();
const result = { health };
const a = await open({ t: 'hello', proto, name: 'Ana', tun, create: true });
result.create = a.m.t === 'reject' ? a.m.reason : { room: a.m.room, players: a.m.players?.length };
if (a.m.t === 'lobby') {
  const b = await open({ t: 'hello', proto, name: 'Beto', tun, room: a.m.room });
  result.join = b.m.t === 'reject' ? b.m.reason : { room: b.m.room, players: b.m.players?.map((p) => p.name) };
  const c = await open({ t: 'hello', proto, name: 'Cris', tun, room: 'ZZZZZ' });
  result.wrongCode = c.m.t === 'reject' ? c.m.reason : c.m;
  for (const x of [a, b, c]) x.ws.close();
}
console.log(JSON.stringify(result));
process.exit(0);
