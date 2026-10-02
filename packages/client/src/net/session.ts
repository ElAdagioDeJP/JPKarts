// LAN session in the browser/Electron renderer: WebSocket to the authoritative server.
import {
  LAN_PORT, PROTOCOL_VERSION, PredictedRace, handshakeTunables,
  type ClientMsg, type LobbyPlayer, type LobbySettings, type ServerMsg, type Track,
} from '@jpkart/core';

export type NetStatus = 'connecting' | 'lobby' | 'race' | 'closed';

/** Desktop app bridge (apps/desktop/src/preload.ts); undefined in the browser. */
export interface DesktopBridge {
  host(name: string): Promise<{ port: number; addresses: string[] }>;
  stopHost(): Promise<boolean>;
  discover(): Promise<{ name: string; address: string; port: number; players: number }[]>;
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<boolean>;
}
export const desktop = (): DesktopBridge | undefined => (globalThis as { jpkartDesktop?: DesktopBridge }).jpkartDesktop;

export class NetSession {
  ws: WebSocket | null = null;
  status: NetStatus = 'connecting';
  id = -1;
  players: LobbyPlayer[] = [];
  settings: LobbySettings = { mode: 'free', trackIndex: 0, cup: 0, diff: 1, laps: 3 };
  phase: 'lobby' | 'race' | 'standings' = 'lobby';
  cupRace = 0;
  cupPts: Record<number, number> = {};
  race: PredictedRace | null = null;
  error = '';
  lastEnd: { order: number[]; points: Record<number, number> } | null = null;
  /** visual smoothing of reconciliation jumps of the local kart */
  visOff = { x: 0, y: 0 };
  bytesIn = 0;

  constructor(public url: string, public name: string, private trackFor: (index: number) => Track, private onStart: () => void, private onEnd: () => void) {}

  static urlFrom(addr: string) {
    const a = addr.trim() || 'localhost';
    const host = a.includes(':') ? a : `${a}:${LAN_PORT}`;
    return host.startsWith('ws') ? host : `ws://${host}`;
  }

  connect() {
    try { this.ws = new WebSocket(this.url); } catch (e) { this.status = 'closed'; this.error = 'Dirección no válida'; return; }
    this.ws.onopen = () => this.send({ t: 'hello', proto: PROTOCOL_VERSION, name: this.name, tun: handshakeTunables() });
    this.ws.onmessage = (ev) => { this.bytesIn += String(ev.data).length; this.handle(JSON.parse(String(ev.data)) as ServerMsg); };
    this.ws.onclose = () => { if (this.status !== 'closed') { this.status = 'closed'; if (!this.error) this.error = 'Se perdió la conexión con el anfitrión'; } };
    this.ws.onerror = () => { if (!this.error) this.error = `No se pudo conectar a ${this.url}`; };
  }

  send(m: ClientMsg) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  close() { this.send({ t: 'leave' }); this.status = 'closed'; this.ws?.close(); }

  get me(): LobbyPlayer | undefined { return this.players.find((p) => p.id === this.id); }
  get isHost() { return !!this.me?.host; }

  private handle(m: ServerMsg) {
    switch (m.t) {
      case 'welcome': this.id = m.id; this.status = 'lobby'; break;
      case 'reject': this.error = m.reason; this.status = 'closed'; this.ws?.close(); break;
      case 'lobby':
        this.players = m.players; this.settings = m.settings; this.phase = m.phase; this.cupRace = m.cupRace; this.cupPts = m.cupPts;
        if (m.phase !== 'race' && this.status === 'race') this.status = 'lobby';
        break;
      case 'start':
        this.race = new PredictedRace(m.cfg, this.trackFor(m.cfg.trackIndex), m.kart);
        this.status = 'race'; this.lastEnd = null; this.visOff = { x: 0, y: 0 };
        this.onStart();
        break;
      case 'snap': {
        const r = this.race;
        if (!r) break;
        const k0 = r.world.karts[r.kart], bx = k0?.x ?? 0, by = k0?.y ?? 0;
        r.onSnapshot(m);
        const k1 = r.world.karts[r.kart];
        if (k1) { this.visOff.x += bx - k1.x; this.visOff.y += by - k1.y; }
        break;
      }
      case 'end': this.lastEnd = { order: m.order, points: m.points }; this.onEnd(); break;
    }
  }

  /** Decay the visual correction offset (exponential, ~120 ms). */
  smooth(dt: number) {
    const k = Math.exp(-dt / 0.12);
    this.visOff.x *= k; this.visOff.y *= k;
    if (Math.hypot(this.visOff.x, this.visOff.y) > 60) this.visOff = { x: 0, y: 0 }; // teleports: snap
  }
}
