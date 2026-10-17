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
  settings: LobbySettings = { mode: 'cup', trackIndex: 0, cup: 0, diff: 1, laps: 3 };
  phase: 'lobby' | 'race' | 'standings' = 'lobby';
  cupRace = 0;
  cupPts: Record<number, number> = {};
  /** seconds until the server starts the next race by itself (standings) */
  nextIn = 0;
  race: PredictedRace | null = null;
  error = '';
  lastEnd: { order: number[]; points: Record<number, number> } | null = null;
  /** visual smoothing of reconciliation jumps of the local kart */
  visOff = { x: 0, y: 0 };
  bytesIn = 0;
  /** race id of the race this session is playing (stale messages of another race are ignored) */
  rid = 0;
  /** the countdown may run: every human built the track (the server said `go`) */
  go = false;
  /** the server waits for slow clients: how many are ready */
  loading: { done: number; total: number } | null = null;
  /** the host pressed start: seconds left to confirm the kart before the server picks one (0 = no countdown) */
  pickIn = 0;
  /** when the last snapshot arrived (ms): a silent line while racing means the connection is dead */
  lastSnapAt = 0;

  /** online room code (shown in the lobby so the host can share it) */
  room = '';
  constructor(public url: string, public name: string, private trackFor: (index: number, mirror: boolean) => Track, private onStart: () => void, private onEnd: () => void, private opts: { room?: string; create?: boolean; pid?: string } = {}) {}

  /** Online server address: wss:// for a domain (TLS at the proxy), ws:// for localhost or an IP with a port. */
  static onlineUrl(addr: string) {
    const a = addr.trim();
    if (a.startsWith('ws')) return a;
    return /^(localhost|\d+\.\d+\.\d+\.\d+)(:\d+)?$/.test(a) ? 'ws://' + (a.includes(':') ? a : a + ':' + LAN_PORT) : 'wss://' + a;
  }

  static urlFrom(addr: string) {
    const a = addr.trim() || 'localhost';
    const host = a.includes(':') ? a : `${a}:${LAN_PORT}`;
    return host.startsWith('ws') ? host : `ws://${host}`;
  }

  connect() {
    try { this.ws = new WebSocket(this.url); } catch (e) { this.status = 'closed'; this.error = 'Dirección no válida'; return; }
    this.ws.onopen = () => this.send({ t: 'hello', proto: PROTOCOL_VERSION, name: this.name, tun: handshakeTunables(), ...this.opts });
    this.ws.onmessage = (ev) => { this.bytesIn += String(ev.data).length; this.handle(JSON.parse(String(ev.data)) as ServerMsg); };
    this.ws.onclose = () => { if (this.status !== 'closed') { this.status = 'closed'; if (!this.error) this.error = 'Se perdió la conexión con el anfitrión'; } };
    this.ws.onerror = () => { if (!this.error) this.error = `No se pudo conectar a ${this.url}`; };
  }

  /** The line went quiet: give up on this socket (the game tries to come back). */
  abandon() { if (this.status !== 'closed') { this.status = 'closed'; if (!this.error) this.error = 'Se perdió la conexión con el servidor'; } try { this.ws?.close(); } catch { /* already closed */ } }

  send(m: ClientMsg) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  close() { this.send({ t: 'leave' }); this.status = 'closed'; this.ws?.close(); }

  get me(): LobbyPlayer | undefined { return this.players.find((p) => p.id === this.id); }
  /** Players on this screen (split screen over the network): this connection's seats. */
  get localSeats(): LobbyPlayer[] { return this.players.filter((p) => p.conn === this.id).sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0)); }
  get isHost() { return !!this.me?.host; }

  private handle(m: ServerMsg) {
    switch (m.t) {
      case 'welcome': this.id = m.id; this.status = 'lobby'; this.room = m.room ?? ''; break;
      case 'reject': this.error = m.reason; this.status = 'closed'; this.ws?.close(); break;
      case 'lobby':
        this.players = m.players; this.settings = m.settings; this.phase = m.phase; this.cupRace = m.cupRace; this.cupPts = m.cupPts; this.nextIn = m.nextIn ?? 0; this.loading = m.loading ?? null; this.pickIn = m.pickIn ?? 0;
        if (m.phase !== 'race' && this.status === 'race') this.status = 'lobby';
        break;
      case 'start':
        this.race = new PredictedRace(m.cfg, this.trackFor(m.cfg.trackIndex, !!m.cfg.mirror), m.kart, m.seats ?? []);
        this.status = 'race'; this.lastEnd = null; this.visOff = { x: 0, y: 0 };
        this.rid = m.rid; this.go = !!m.resume; this.lastSnapAt = performance.now();
        this.onStart();
        // the track is built: tell the server (the countdown waits for everybody)
        if (!m.resume) this.send({ t: 'loaded', rid: m.rid });
        break;
      case 'go': if (m.rid === this.rid) { this.go = true; this.lastSnapAt = performance.now(); } break;
      case 'snap': {
        const r = this.race;
        if (!r || m.rid !== this.rid) break;
        this.lastSnapAt = performance.now();
        const drifted = r.needResync;
        r.ingest(m); // cheap; the re-simulation happens once per frame in flushSnaps()
        if (r.needResync && !drifted) this.send({ t: 'resync' });
        this.snapDirty = true;
        break;
      }
      case 'end': if (m.rid !== this.rid) break; this.lastEnd = { order: m.order, points: m.points }; this.onEnd(); break;
    }
  }

  private snapDirty = false;
  /** Reconcile every snapshot that arrived since the last call, once (a burst after a stall used to re-simulate for each one). */
  flushSnaps() {
    const r = this.race;
    if (!r || !this.snapDirty) return;
    this.snapDirty = false;
    const k0 = r.world.karts[r.kart], bx = k0?.x ?? 0, by = k0?.y ?? 0;
    r.reconcile();
    const k1 = r.world.karts[r.kart];
    if (k1) { this.visOff.x += bx - k1.x; this.visOff.y += by - k1.y; }
  }

  /** Decay the visual correction offset (exponential, ~120 ms). */
  smooth(dt: number) {
    const k = Math.exp(-dt / 0.12);
    this.visOff.x *= k; this.visOff.y *= k;
    if (Math.hypot(this.visOff.x, this.visOff.y) > 60) this.visOff = { x: 0, y: 0 }; // teleports: snap
  }
}
