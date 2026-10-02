// Authoritative race room, independent of the transport (WebSocket in main.ts, in-memory in tests).
import {
  ALL_TRACKS, ARENA_INDICES, CLASSES, CUPS, LAPS, PROTOCOL_VERSION, classCfg, cleanName, validPacked, ReplayRecorder, Rng, SNAPSHOT_EVERY, TrackCache, buildGrid, createWorld, diffJson, handshakeTunables, modeOf,
  newAiState, prepAuthored, serializeWorld, step, takeEvents, unpackInput,
  type ClientMsg, type Delta, type Input, type LobbyPlayer, type LobbySettings, type PackedInput, type ServerMsg, type World, type WorldState,
} from '@jpkart/core';

export interface Conn { id: number; send(m: ServerMsg): void; close(): void }

interface Player {
  conn: Conn;
  /** 0 = the connection's own player; 1–3 = extra local players on the same screen (split screen) */
  seat: number;
  name: string;
  ch: number;
  ready: boolean;
  host: boolean;
  queue: PackedInput[];
  last: PackedInput;
  kart: number;
}

const MAX_PLAYERS = 8, MAX_QUEUE = 6;

export class Room {
  players = new Map<number, Player>();
  settings: LobbySettings = { mode: 'free', trackIndex: CUPS[0]!.tracks[0]!, cup: 0, diff: 1, laps: LAPS };
  phase: 'lobby' | 'race' | 'standings' = 'lobby';
  world: World | null = null;
  recorder: ReplayRecorder | null = null;
  cupRace = 0;
  cupPts: Record<number, number> = {};
  tracks = new TrackCache(ALL_TRACKS, prepAuthored);
  /** bytes sent per client (metrics) */
  sentBytes = 0;
  private seed: number;
  /** online room code (undefined on LAN) */
  code: string | undefined;
  /** last broadcast state: snapshots after the first one are deltas against it */
  private lastState: WorldState | null = null;

  constructor(seed = Date.now() & 0x7fffffff, public log: (m: string) => void = () => {}) {
    this.seed = seed;
  }

  /** The connection's player plus its extra seats, in seat order. */
  private seatsOf(connId: number) { return [...this.players.values()].filter((q) => q.conn.id === connId).sort((a, b) => a.seat - b.seat); }
  private send(p: Player, m: ServerMsg) {
    const s = JSON.stringify(m);
    this.sentBytes += s.length;
    p.conn.send(m);
  }
  /** One message per connection (extra seats share their connection). */
  private broadcast(m: ServerMsg) { for (const p of this.players.values()) if (p.seat === 0) this.send(p, m); }

  private lobbyMsg(): ServerMsg {
    const players: LobbyPlayer[] = [...this.players.entries()].map(([id, p]) => ({ id, name: p.name, ch: p.ch, ready: p.ready, host: p.host, seat: p.seat, conn: p.conn.id }));
    return { t: 'lobby', players, settings: this.settings, phase: this.phase, cupRace: this.cupRace, cupPts: this.cupPts, room: this.code };
  }

  join(conn: Conn) {
    // the player is registered on 'hello'
    void conn;
  }

  leave(id: number) {
    const p = this.players.get(id);
    if (!p) return;
    for (const q of this.seatsOf(p.conn.id)) if (q !== p) { this.players.delete(this.idOf(q)); this.dropKart(q); }
    this.players.delete(id);
    this.log(`${p.name} salió`);
    if (p.host) { const next = this.players.values().next().value as Player | undefined; if (next) next.host = true; }
    this.dropKart(p);
    if (!this.players.size) { this.phase = 'lobby'; this.world = null; }
    this.broadcast(this.lobbyMsg());
  }

  /** Player ids: the connection id for seat 0, negative ids for the extra seats (they never collide). */
  private idOf(p: Player) { return p.seat === 0 ? p.conn.id : -(p.conn.id * 8 + p.seat); }
  /** mid-race: the AI takes over the kart */
  private dropKart(p: Player) {
    if (!this.world || p.kart < 0) return;
    const k = this.world.karts[p.kart];
    if (k) { k.ctrl = 'ai'; k.ai = newAiState(this.world); }
  }
  private seatPlayer(conn: Conn, seat: unknown): Player | undefined {
    const s = seat === undefined ? 0 : seat;
    if (!Number.isInteger(s) || (s as number) < 0 || (s as number) > 3) return undefined;
    return this.players.get(s === 0 ? conn.id : -(conn.id * 8 + (s as number)));
  }

  onMessage(conn: Conn, m: ClientMsg) {
    const p = this.players.get(conn.id);
    if (m.t === 'hello') {
      if (m.proto !== PROTOCOL_VERSION) { conn.send({ t: 'reject', reason: `Versión distinta (servidor ${PROTOCOL_VERSION}, cliente ${m.proto}). Actualiza el juego.` }); return; }
      if (m.tun !== handshakeTunables()) { conn.send({ t: 'reject', reason: 'Las reglas del juego no coinciden con las del anfitrión (tunables distintos).' }); return; }
      if (this.players.size >= MAX_PLAYERS) { conn.send({ t: 'reject', reason: 'La sala está llena (8 jugadores).' }); return; }
      if (this.phase !== 'lobby') { conn.send({ t: 'reject', reason: 'La carrera ya empezó. Espera a que termine.' }); return; }
      const taken = new Set([...this.players.values()].map((q) => q.ch));
      let ch = 0;
      while (taken.has(ch)) ch++;
      const name = cleanName(m.name);
      this.players.set(conn.id, { conn, seat: 0, name, ch, ready: false, host: this.players.size === 0, queue: [], last: [0, 0, 0, 0, 0], kart: -1 });
      conn.send({ t: 'welcome', id: conn.id, proto: PROTOCOL_VERSION, room: this.code });
      this.log(`${name} entró` + (this.code ? ` en la sala ${this.code}` : ''));
      this.broadcast(this.lobbyMsg());
      return;
    }
    if (!p) return;
    switch (m.t) {
      case 'addSeat': {
        const seats = this.seatsOf(conn.id);
        if (this.phase !== 'lobby' || seats.length >= 4 || this.players.size >= MAX_PLAYERS) return;
        const taken = new Set([...this.players.values()].map((q) => q.ch));
        let ch = 0;
        while (taken.has(ch)) ch++;
        const seat = seats.length, q: Player = { conn, seat, name: cleanName(m.name), ch, ready: true, host: false, queue: [], last: [0, 0, 0, 0, 0], kart: -1 };
        this.players.set(this.idOf(q), q);
        this.broadcast(this.lobbyMsg());
        break;
      }
      case 'pick': {
        const sp = this.seatPlayer(conn, m.seat);
        if (!sp || this.phase !== 'lobby' || !Number.isInteger(m.ch) || m.ch < 0 || m.ch > 7) return;
        if ([...this.players.values()].some((q) => q !== sp && q.ch === m.ch)) return;
        sp.ch = m.ch; sp.ready = sp.seat > 0;
        this.broadcast(this.lobbyMsg());
        break;
      }
      case 'ready': p.ready = m.ready === true; this.broadcast(this.lobbyMsg()); break;
      case 'settings': {
        if (!p.host || this.phase !== 'lobby') return;
        const s = m.s;
        if (!s || typeof s !== 'object' || ![s.trackIndex, s.cup, s.diff].every(Number.isInteger)) return;
        if (s.trackIndex < 0 || s.trackIndex >= ALL_TRACKS.length || s.cup < 0 || s.cup >= CUPS.length || s.diff < 0 || s.diff > 2) return;
        if (!['free', 'cup', 'elimination', 'battle', 'capture'].includes(s.mode) || (s.cls && !(CLASSES as readonly string[]).includes(s.cls))) return;
        const arena = ARENA_INDICES.includes(s.trackIndex);
        if ((s.mode === 'battle' || s.mode === 'capture') !== arena) return; // battles only on arenas, races never on them
        this.settings = { ...s, laps: LAPS, teams: !!s.teams && (s.mode === 'free' || s.mode === 'cup') };
        this.broadcast(this.lobbyMsg());
        break;
      }
      case 'start': {
        if (!p.host || this.phase !== 'lobby') return;
        if (![...this.players.values()].every((q) => q.ready || q.host)) return;
        this.cupRace = 0;
        this.cupPts = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, 0]));
        this.startRace();
        break;
      }
      case 'next': {
        if (!p.host || this.phase !== 'standings') return;
        if (this.settings.mode === 'cup' && this.cupRace < CUPS[this.settings.cup]!.tracks.length - 1) { this.cupRace++; this.startRace(); }
        else { this.phase = 'lobby'; for (const q of this.players.values()) q.ready = q.seat > 0; this.broadcast(this.lobbyMsg()); }
        break;
      }
      case 'in': {
        if (this.phase !== 'race') return;
        const lists: [Player | undefined, unknown][] = [[p, m.i], ...(Array.isArray(m.seats) ? m.seats.slice(0, 3).map((l, k) => [this.seatPlayer(conn, k + 1), l] as [Player | undefined, unknown]) : [])];
        for (const [q, list] of lists) {
          if (!q || !Array.isArray(list) || list.length > 12) continue;
          for (const i of list) if (validPacked(i) && i[0] > (q.queue.at(-1)?.[0] ?? q.last[0])) q.queue.push(i);
          while (q.queue.length > MAX_QUEUE) q.queue.shift();
        }
        break;
      }
      case 'leave': this.leave(conn.id); break;
    }
  }

  private startRace() {
    const S = this.settings;
    const ti = S.mode === 'cup' ? CUPS[S.cup]!.tracks[this.cupRace]! : S.trackIndex;
    const cc = classCfg((S.cls ?? '100') as (typeof CLASSES)[number]), mirror = cc.mirror && !!this.tracks.get(ti).authored;
    const track = this.tracks.ensureBuilt(ti, [], mirror);
    const seed = (this.seed = (Math.imul(this.seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0) & 0x7fffffff);
    const humans = [...this.players.values()].map((p) => ({ ch: p.ch, ctrl: 'remote' as const }));
    let grid = S.mode === 'cup' && this.cupRace > 0 ? buildGrid(new Rng(seed), humans, { cupPts: this.cupPts, humanSlot: 0 }) : buildGrid(new Rng(seed), humans, { humanSlot: 8 - humans.length });
    if (S.teams) grid = grid.map((g, i) => ({ ...g, team: i % 2 }));
    const mode = S.mode === 'free' ? 'race' : S.mode;
    const laps = modeOf({ cfg: { mode } } as World).laps?.(grid.length) ?? S.laps;
    const cfg = { trackIndex: ti, diff: S.diff, seed, laps, grid, mode, cc: cc.cc, mirror, teams: !!S.teams };
    this.world = createWorld(cfg, track);
    this.recorder = new ReplayRecorder(cfg);
    for (const p of this.players.values()) { p.kart = this.world.karts.findIndex((k) => k.ch === p.ch); p.queue = []; p.last = [0, 0, 0, 0, 0]; }
    for (const p of this.players.values()) {
      if (p.seat !== 0) continue;
      const extra = this.seatsOf(p.conn.id).filter((q) => q.seat > 0).map((q) => q.kart);
      this.send(p, extra.length ? { t: 'start', cfg, kart: p.kart, seats: extra } : { t: 'start', cfg, kart: p.kart });
    }
    this.lastState = null;
    this.phase = 'race';
    this.log(`Carrera en ${track.def.name} con ${this.players.size} humano(s)`);
  }

  /** One authoritative tick (60 Hz). */
  tick() {
    const w = this.world;
    if (!w || this.phase !== 'race') return;
    const inputs: Input[] = [];
    for (const p of this.players.values()) {
      const next = p.queue.shift();
      if (next) p.last = next;
      inputs[p.kart] = unpackInput(p.last);
    }
    this.recorder?.record(w, inputs);
    step(w, inputs);
    this.recorder?.after(w);
    let ended = false;
    for (const e of takeEvents(w)) if (e.type === 'raceEnd') ended = true;
    if (w.tick % SNAPSHOT_EVERY === 0 || ended) {
      const state = serializeWorld(w);
      const last: Record<number, PackedInput> = {};
      for (const p of this.players.values()) last[p.kart] = p.last;
      const delta = this.lastState ? (diffJson(this.lastState, state) as Delta | undefined) ?? {} : undefined;
      for (const p of this.players.values()) if (p.seat === 0) this.send(p, delta ? { t: 'snap', tick: w.tick, ack: p.last[0], delta, last } : { t: 'snap', tick: w.tick, ack: p.last[0], state, last });
      this.lastState = state;
    }
    if (ended) {
      const pts = modeOf(w).scoring?.(w, w.finalOrder) ?? new Map<number, number>();
      const points: Record<number, number> = {};
      for (const [kart, v] of pts) { const ch = w.karts[kart]!.ch; points[ch] = v; this.cupPts[ch] = (this.cupPts[ch] ?? 0) + v; }
      this.broadcast({ t: 'end', order: w.finalOrder, points });
      this.phase = 'standings';
      this.broadcast(this.lobbyMsg());
    }
  }
}
