// Authoritative race room, independent of the transport (WebSocket in main.ts, in-memory in tests).
import {
  ALL_TRACKS, ARENA_INDICES, CLASSES, CUPS, LAPS, PROTOCOL_VERSION, classCfg, ReplayRecorder, Rng, SNAPSHOT_EVERY, TrackCache, buildGrid, createWorld, diffJson, handshakeTunables, modeOf,
  newAiState, prepAuthored, serializeWorld, step, takeEvents, unpackInput,
  type ClientMsg, type Delta, type Input, type LobbyPlayer, type LobbySettings, type PackedInput, type ServerMsg, type World, type WorldState,
} from '@jpkart/core';

export interface Conn { id: number; send(m: ServerMsg): void; close(): void }

interface Player {
  conn: Conn;
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
  settings: LobbySettings = { mode: 'free', trackIndex: 0, cup: 0, diff: 1, laps: LAPS };
  phase: 'lobby' | 'race' | 'standings' = 'lobby';
  world: World | null = null;
  recorder: ReplayRecorder | null = null;
  cupRace = 0;
  cupPts: Record<number, number> = {};
  tracks = new TrackCache(ALL_TRACKS, prepAuthored);
  /** bytes sent per client (metrics) */
  sentBytes = 0;
  private seed: number;
  /** last broadcast state: snapshots after the first one are deltas against it */
  private lastState: WorldState | null = null;

  constructor(seed = Date.now() & 0x7fffffff, public log: (m: string) => void = () => {}) {
    this.seed = seed;
  }

  private send(p: Player, m: ServerMsg) {
    const s = JSON.stringify(m);
    this.sentBytes += s.length;
    p.conn.send(m);
  }
  private broadcast(m: ServerMsg) { for (const p of this.players.values()) this.send(p, m); }

  private lobbyMsg(): ServerMsg {
    const players: LobbyPlayer[] = [...this.players.entries()].map(([id, p]) => ({ id, name: p.name, ch: p.ch, ready: p.ready, host: p.host }));
    return { t: 'lobby', players, settings: this.settings, phase: this.phase, cupRace: this.cupRace, cupPts: this.cupPts };
  }

  join(conn: Conn) {
    // the player is registered on 'hello'
    void conn;
  }

  leave(id: number) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.log(`${p.name} salió`);
    if (p.host) { const next = this.players.values().next().value as Player | undefined; if (next) next.host = true; }
    // mid-race: the AI takes over the kart
    if (this.world && p.kart >= 0) {
      const k = this.world.karts[p.kart];
      if (k) { k.ctrl = 'ai'; k.ai = newAiState(this.world); }
    }
    if (!this.players.size) { this.phase = 'lobby'; this.world = null; }
    this.broadcast(this.lobbyMsg());
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
      this.players.set(conn.id, { conn, name: (m.name || 'Jugador').slice(0, 12), ch, ready: false, host: this.players.size === 0, queue: [], last: [0, 0, 0, 0, 0], kart: -1 });
      conn.send({ t: 'welcome', id: conn.id, proto: PROTOCOL_VERSION });
      this.log(`${m.name} entró`);
      this.broadcast(this.lobbyMsg());
      return;
    }
    if (!p) return;
    switch (m.t) {
      case 'pick': {
        if (this.phase !== 'lobby' || m.ch < 0 || m.ch > 7) return;
        if ([...this.players.values()].some((q) => q !== p && q.ch === m.ch)) return;
        p.ch = m.ch; p.ready = false;
        this.broadcast(this.lobbyMsg());
        break;
      }
      case 'ready': p.ready = m.ready; this.broadcast(this.lobbyMsg()); break;
      case 'settings': {
        if (!p.host || this.phase !== 'lobby') return;
        const s = m.s;
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
        else { this.phase = 'lobby'; for (const q of this.players.values()) q.ready = false; this.broadcast(this.lobbyMsg()); }
        break;
      }
      case 'in': {
        if (this.phase !== 'race') return;
        for (const i of m.i) if (i[0] > (p.queue.at(-1)?.[0] ?? p.last[0])) p.queue.push(i);
        while (p.queue.length > MAX_QUEUE) p.queue.shift();
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
    for (const p of this.players.values()) {
      p.kart = this.world.karts.findIndex((k) => k.ch === p.ch);
      p.queue = []; p.last = [0, 0, 0, 0, 0];
      this.send(p, { t: 'start', cfg, kart: p.kart });
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
      for (const p of this.players.values()) this.send(p, delta ? { t: 'snap', tick: w.tick, ack: p.last[0], delta, last } : { t: 'snap', tick: w.tick, ack: p.last[0], state, last });
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
