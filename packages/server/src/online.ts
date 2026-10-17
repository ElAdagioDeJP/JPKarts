// Online server (docs/PLAN.md Fase 11): many rooms on one process, each identified by a 5-character code.
// Same authoritative Room as the LAN server; this layer adds room codes, limits and a health check for the proxy.
// Run: `bun packages/server/src/online.ts` (PORT env, default 7777). Behind Traefik the clients use wss://.
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { LAN_PORT, ROOM_ALPHABET, SIM_DT, cleanRoomCode, type ClientMsg } from '@jpkart/core';
import { Room, type Conn } from './room';

export const ONLINE_LIMITS = {
  /** rooms per server process */
  maxRooms: 200,
  /** messages per second per connection (inputs arrive at 60 Hz; anything far above is abuse) */
  msgsPerSec: 150,
  /** bytes per message */
  maxPayload: 8 * 1024,
  /** a connection that never says hello is closed after this many ms */
  helloTimeout: 10_000,
  /** ping every this many ms; a connection that never answers is dropped (keeps proxies from closing idle sockets, frees dead players) */
  heartbeat: 10_000,
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.map': 'application/json',
};

/** Static web client (vite build) served next to the WebSocket: the same domain gives the game and the rooms. */
export function webHandler(dir: string | undefined) {
  const root = dir && existsSync(join(dir, 'index.html')) ? resolve(dir) : null;
  return (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
    if (!root || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
    let path: string;
    try { path = decodeURIComponent((req.url ?? '/').split('?')[0]!); } catch { return false; }
    let file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) return false; // path traversal
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
    const ext = extname(file), body = readFileSync(file);
    // hashed vite assets never change; index.html always revalidates
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': file.includes(sep + 'assets' + sep) ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}

export interface OnlineHandle { port: number; rooms: Map<string, Room>; close(): void; onMessage(conn: Conn, raw: string): void; onClose(conn: Conn): void }

/** Transport-free core of the online server (the tests drive it directly). */
export function createOnline(log: (m: string) => void = console.log, limits = ONLINE_LIMITS) {
  const rooms = new Map<string, Room>();
  const roomOf = new Map<number, Room>();
  const rate = new Map<number, { t: number; n: number }>();
  const newCode = () => {
    for (;;) {
      let c = '';
      for (let i = 0; i < 5; i++) c += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
      if (!rooms.has(c)) return c;
    }
  };
  const drop = (r: Room) => { if (r.players.size === 0 && r.code) { rooms.delete(r.code); log(`Sala ${r.code} cerrada`); } };

  function onMessage(conn: Conn, raw: string) {
    // rate limit (sliding one-second window)
    const now = Date.now(), rt = rate.get(conn.id) ?? { t: now, n: 0 };
    if (now - rt.t > 1000) { rt.t = now; rt.n = 0; }
    rt.n++;
    rate.set(conn.id, rt);
    if (rt.n > limits.msgsPerSec) return;
    let m: ClientMsg;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object' || typeof (m as { t?: unknown }).t !== 'string') return;
    let room = roomOf.get(conn.id);
    if (!room) {
      if (m.t !== 'hello') return;
      if (m.create) {
        if (rooms.size >= limits.maxRooms) { conn.send({ t: 'reject', reason: 'El servidor está lleno. Prueba más tarde.' }); return; }
        room = new Room(undefined, log);
        room.code = newCode();
        rooms.set(room.code, room);
        log(`Sala ${room.code} creada`);
      } else {
        const code = cleanRoomCode(m.room);
        room = rooms.get(code);
        if (!room) { conn.send({ t: 'reject', reason: code ? `No existe la sala ${code}.` : 'Escribe el código de la sala.' }); return; }
      }
      room.onMessage(conn, m);
      if (room.players.has(conn.id)) roomOf.set(conn.id, room);
      else drop(room); // rejected (version, full, racing...)
      return;
    }
    if (m.t === 'hello') return;
    room.onMessage(conn, m);
  }
  function onClose(conn: Conn) {
    rate.delete(conn.id);
    const room = roomOf.get(conn.id);
    if (!room) return;
    roomOf.delete(conn.id);
    room.leave(conn.id);
    drop(room);
  }
  function tick() { for (const r of rooms.values()) r.tick(); }
  return { rooms, onMessage, onClose, tick };
}

export function startOnlineServer(port = Number(process.env.PORT ?? LAN_PORT), log: (m: string) => void = console.log, limits = ONLINE_LIMITS): OnlineHandle {
  const core = createOnline(log, limits);
  const web = webHandler(process.env.WEB_DIR);
  const server = http.createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`ok ${core.rooms.size} salas`); return; }
    if (web(req, res)) return;
    res.writeHead(404); res.end();
  });
  const wss = new WebSocketServer({ server, maxPayload: limits.maxPayload, perMessageDeflate: { threshold: 256, zlibDeflateOptions: { level: 3 } } });
  let nextId = 1;
  wss.on('connection', (ws: WebSocket) => {
    const conn: Conn = { id: nextId++, send: (m) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); }, close: () => ws.close() };
    const hello = setTimeout(() => { if (!core.rooms.size || ![...core.rooms.values()].some((r) => r.players.has(conn.id))) ws.close(); }, limits.helloTimeout);
    ws.on('message', (data) => core.onMessage(conn, String(data)));
    let alive = true;
    ws.on('pong', () => { alive = true; });
    const beat = setInterval(() => { if (!alive) { ws.terminate(); return; } alive = false; ws.ping(); }, limits.heartbeat);
    ws.on('close', () => { clearTimeout(hello); clearInterval(beat); core.onClose(conn); });
    ws.on('error', () => ws.close());
  });
  let last = performance.now(), acc = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    acc = Math.min(acc + (now - last) / 1000, SIM_DT * 5);
    last = now;
    while (acc >= SIM_DT) { core.tick(); acc -= SIM_DT; }
  }, 4);
  server.listen(port);
  log(`JP Kart online: escuchando en el puerto ${port} (salas con código)`);
  return { port, rooms: core.rooms, onMessage: core.onMessage, onClose: core.onClose, close: () => { clearInterval(timer); wss.close(); server.close(); } };
}

if (import.meta.main) startOnlineServer();
