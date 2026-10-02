// Headless LAN server: `bun run server` (or embedded in Electron). WebSocket on port 7777.
import { WebSocketServer, type WebSocket } from 'ws';
import { LAN_PORT, SIM_DT, type ClientMsg } from '@jpkart/core';
import { Room, type Conn } from './room';

export interface ServerHandle { port: number; room: Room; close(): void }

export function startServer(port = LAN_PORT, log: (m: string) => void = console.log): ServerHandle {
  const room = new Room(undefined, log);
  const wss = new WebSocketServer({ port, perMessageDeflate: { threshold: 256, zlibDeflateOptions: { level: 3 } } });
  let nextId = 1;
  wss.on('connection', (ws: WebSocket) => {
    const conn: Conn = { id: nextId++, send: (m) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); }, close: () => ws.close() };
    room.join(conn);
    ws.on('message', (data) => {
      let m: ClientMsg;
      try { m = JSON.parse(String(data)); } catch { return; }
      room.onMessage(conn, m);
    });
    ws.on('close', () => room.leave(conn.id));
  });
  // fixed 60 Hz loop with an accumulator (catches up after hiccups, at most 5 ticks)
  let last = performance.now(), acc = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    acc = Math.min(acc + (now - last) / 1000, SIM_DT * 5);
    last = now;
    while (acc >= SIM_DT) { room.tick(); acc -= SIM_DT; }
  }, 4);
  log(`JP Kart: servidor LAN escuchando en el puerto ${port}`);
  return { port, room, close: () => { clearInterval(timer); wss.close(); } };
}

if (import.meta.main) startServer(Number(process.env.PORT ?? LAN_PORT));
