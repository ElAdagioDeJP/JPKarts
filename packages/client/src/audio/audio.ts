// Synthesized chiptune audio (ported from legacy). Buses: master ← music, sfx, engine, voice.
import type { Character, SongId } from '@jpkart/core';

export class Audio {
  AC: AudioContext | null = null;
  muted = false;
  private master!: GainNode;
  sfx!: GainNode;
  private voice!: GainNode;
  private engBus!: GainNode;
  private eng: { o: OscillatorNode; g: GainNode } | null = null;
  private mus = { id: null as SongId | null, mul: 1, step: 0, next: 0, bus: null as GainNode | null, lead: null as GainNode | null, noise: null as AudioBuffer | null, timer: 0 as any };
  volumes = { music: 0.9, sfx: 1, engine: 1, voice: 1 };
  /** 0..1: drives the drum layers of the adaptive music */
  intensity = 0.5;
  private rivals: { o: OscillatorNode; g: GainNode; p: StereoPannerNode }[] = [];
  private duckUntil = 0;

  init() {
    if (this.AC) return;
    try {
      const AC = new AudioContext();
      this.AC = AC;
      this.master = AC.createGain();
      const lim = AC.createDynamicsCompressor();
      lim.threshold.value = -3; lim.ratio.value = 12;
      this.master.connect(lim); lim.connect(AC.destination);
      this.sfx = AC.createGain(); this.sfx.connect(this.master);
      this.voice = AC.createGain(); this.voice.connect(this.master);
      this.engBus = AC.createGain(); this.engBus.connect(this.master);
      const o = AC.createOscillator(); o.type = 'sawtooth';
      const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520;
      const g = AC.createGain(); g.gain.value = 0;
      o.connect(f); f.connect(g); g.connect(this.engBus); o.start();
      this.eng = { o, g };
      // three positional engine voices for the nearest rivals
      for (let i = 0; i < 3; i++) {
        const ro = AC.createOscillator(); ro.type = 'sawtooth';
        const rf = AC.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 420;
        const rg = AC.createGain(); rg.gain.value = 0;
        const rp = AC.createStereoPanner();
        ro.connect(rf); rf.connect(rg); rg.connect(rp); rp.connect(this.engBus); ro.start();
        this.rivals.push({ o: ro, g: rg, p: rp });
      }
    } catch { this.AC = null; }
  }

  beep(freq: number, dur = 0.1, type: OscillatorType = 'square', vol = 0.05, slide = 0) {
    const AC = this.AC;
    if (!AC || this.muted) return;
    const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.02);
  }
  blip() { this.beep(620, 0.06); }

  engineSet(on: boolean, speed: number) {
    if (!this.eng || !this.AC) return;
    const t = this.AC.currentTime;
    this.eng.g.gain.setTargetAtTime(on && !this.muted ? 0.014 : 0, t, 0.05);
    this.eng.o.frequency.setTargetAtTime(48 + Math.abs(speed) * 0.75, t, 0.05);
  }

  /** Bus volumes from the settings (0..1 sliders; perceived loudness handled by squaring). */
  setVolumes(music: number, sfx: number) {
    this.volumes.music = music * music;
    this.volumes.sfx = sfx;
    if (!this.AC) return;
    this.sfx.gain.setTargetAtTime(sfx * sfx, this.AC.currentTime, 0.05);
    this.voice.gain.setTargetAtTime(sfx * sfx, this.AC.currentTime, 0.05);
    this.engBus.gain.setTargetAtTime(sfx * sfx, this.AC.currentTime, 0.05);
  }

  /** Nearest rivals' engines: distance attenuation and stereo pan by angle (audio-design). */
  rivalEngines(list: { dist: number; pan: number; speed: number }[]) {
    if (!this.AC) return;
    const t = this.AC.currentTime;
    this.rivals.forEach((v, i) => {
      const r = list[i];
      const vol = r && !this.muted ? 0.009 * Math.max(0, 1 - r.dist / 260) : 0;
      v.g.gain.setTargetAtTime(vol, t, 0.08);
      if (r) { v.p.pan.setTargetAtTime(Math.max(-1, Math.min(1, r.pan)), t, 0.08); v.o.frequency.setTargetAtTime(44 + Math.abs(r.speed) * 0.7, t, 0.08); }
    });
  }

  /** Ducking: dip the music under big moments, then recover. */
  duck(seconds = 0.5) {
    if (!this.AC || !this.mus.bus) return;
    const t = this.AC.currentTime;
    this.duckUntil = t + seconds;
    this.mus.bus.gain.cancelScheduledValues(t);
    this.mus.bus.gain.setTargetAtTime(this.volumes.music * 0.45, t, 0.03);
    this.mus.bus.gain.setTargetAtTime(this.volumes.music * 0.9, t + seconds, 0.25);
  }

  /** Synthesized "¡ay!" groan. */
  groan(ch: Character, vol: number, rand: number) {
    const AC = this.AC;
    if (!AC || this.muted || vol < 0.02) return;
    const t = AC.currentTime, b = ch.voice * (0.95 + rand * 0.13), d = 0.42;
    const o = AC.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(b * 1.3, t); o.frequency.exponentialRampToValueAtTime(b * 1.45, t + 0.06); o.frequency.exponentialRampToValueAtTime(b * 0.78, t + d);
    const lfo = AC.createOscillator(); lfo.frequency.value = 6.5;
    const lg = AC.createGain(); lg.gain.value = b * 0.04; lfo.connect(lg); lg.connect(o.frequency);
    const f1 = AC.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 5; f1.frequency.setValueAtTime(820, t); f1.frequency.linearRampToValueAtTime(360, t + d * 0.8);
    const f2 = AC.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 7; f2.frequency.setValueAtTime(1220, t); f2.frequency.linearRampToValueAtTime(2250, t + d * 0.8);
    const g = AC.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.03); g.gain.setValueAtTime(vol, t + d * 0.45); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(this.voice);
    o.start(t); lfo.start(t); o.stop(t + d + 0.05); lfo.stop(t + d + 0.05);
  }

  // ---------- music ----------
  private mtof = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
  private musicInit() {
    const AC = this.AC;
    if (!AC || this.mus.bus) return;
    const bus = AC.createGain(); bus.gain.value = 0.9; bus.connect(this.master);
    const dl = AC.createDelay(); dl.delayTime.value = 0.19;
    const fb = AC.createGain(); fb.gain.value = 0.25;
    const wet = AC.createGain(); wet.gain.value = 0.3;
    const lead = AC.createGain(); lead.connect(bus); lead.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(bus);
    const len = AC.sampleRate * 0.3, nb = AC.createBuffer(1, len, AC.sampleRate), d = nb.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x7fffffff) * 2 - 1; }
    this.mus.bus = bus; this.mus.lead = lead; this.mus.noise = nb;
    this.mus.timer = setInterval(() => this.musicTick(), 25);
  }
  private note(dest: AudioNode, type: OscillatorType, freq: number, t: number, dur: number, vol: number) {
    const AC = this.AC!, o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.setValueAtTime(vol * 0.7, t + Math.min(dur * 0.5, 0.08)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }
  private drum(kind: 'k' | 's' | 'h', t: number) {
    const AC = this.AC!, bus = this.mus.bus!;
    if (kind === 'k') {
      const o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.16);
      return;
    }
    const n = AC.createBufferSource(); n.buffer = this.mus.noise;
    const f = AC.createBiquadFilter(), g = AC.createGain();
    if (kind === 'h') { f.type = 'highpass'; f.frequency.value = 7000; g.gain.setValueAtTime(0.028, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035); }
    else { f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8; g.gain.setValueAtTime(0.09, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13); this.note(bus, 'triangle', 190, t, 0.08, 0.05); }
    n.connect(f); f.connect(g); g.connect(bus); n.start(t); n.stop(t + 0.15);
  }
  private musicTick() {
    const AC = this.AC, mus = this.mus;
    if (!AC || !mus.id) return;
    const S = SONGS[mus.id], sd = 60 / (S.bpm * mus.mul) / 4;
    if (mus.next < AC.currentTime - 0.25) mus.next = AC.currentTime + 0.05;
    while (mus.next < AC.currentTime + 0.15) {
      const t = mus.next, st = mus.step, bar = (st >> 4) % 8, inBar = st & 15, ci = bar % 4, root = S.roots[ci]!, ch = S.chords[ci]!;
      if (!this.muted) {
        if (!(inBar & 1)) {
          const ln = S.lead[bar]!, e = inBar >> 1, n = ln[e]!;
          if (n > 0) { let len = 1; while (e + len < 8 && ln[e + len] === -1) len++; this.note(mus.lead!, 'square', this.mtof(n), t, sd * 2 * len * 0.95, 0.042); }
          const bn = inBar === 14 ? root + 7 : e % 2 ? root + 12 : root;
          this.note(mus.bus!, 'triangle', this.mtof(bn), t, sd * 1.8, 0.13);
        }
        this.note(mus.bus!, 'square', this.mtof(root + 24 + ch[inBar % 3]!), t, sd * 0.8, 0.012);
        // adaptive layers: calm = bass + lead; more intensity adds kick, snare and hats
        const I = this.intensity;
        if (I > 0.2 && inBar % 4 === 0 && inBar !== 4 && inBar !== 12) this.drum('k', t);
        if (I > 0.45 && (inBar === 4 || inBar === 12) && !S.soft) this.drum('s', t);
        if (I > 0.65 && (S.h16 || inBar % 2 === 0)) this.drum('h', t);
        else if (I > 0.35 && inBar % 4 === 2) this.drum('h', t);
      }
      mus.step++;
      mus.next += sd;
    }
  }
  musicWant(id: SongId | null, mul = 1, vol = 1) {
    const AC = this.AC;
    if (!AC) return;
    this.musicInit();
    if (id !== this.mus.id) { this.mus.id = id; this.mus.step = 0; this.mus.next = AC.currentTime + 0.08; }
    if (!id) return;
    this.mus.mul = mul;
    if (AC.currentTime > this.duckUntil) this.mus.bus!.gain.setTargetAtTime(this.muted ? 0 : vol * this.volumes.music, AC.currentTime, 0.08);
  }
  jingle() {
    const AC = this.AC;
    if (!AC || this.muted) return;
    const t = AC.currentTime;
    [72, 76, 79, 84, 79, 84, 88].forEach((n, i) => {
      this.note(this.sfx, 'square', this.mtof(n), t + i * 0.11, i === 6 ? 0.5 : 0.12, 0.05);
      this.note(this.sfx, 'triangle', this.mtof(n - 24), t + i * 0.11, 0.12, 0.1);
    });
  }
}

interface Song { bpm: number; soft?: boolean; h16?: boolean; roots: number[]; chords: number[][]; lead: number[][] }
// Original 8-bit melodies composed for this game (legacy).
export const SONGS: Record<SongId, Song> = {
  sol: { bpm: 148, roots: [48, 45, 41, 43], chords: [[0, 4, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7]], lead: [
    [72, 0, 76, 79, 81, 79, 76, 0], [72, 74, 76, 74, 72, 69, -1, 0], [69, 72, 77, -1, 76, 74, 72, 0], [74, -1, 71, 74, 79, -1, -1, 0],
    [76, 79, 84, -1, 83, 81, 79, 76], [81, -1, 79, 76, 72, -1, 74, 76], [77, 76, 74, 72, 74, 76, 77, 79], [79, -1, 83, -1, 86, -1, -1, 0]] },
  noche: { bpm: 140, roots: [45, 41, 48, 40], chords: [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]], lead: [
    [69, 72, 76, -1, 74, 72, 71, 72], [69, -1, 65, 69, 72, -1, -1, 0], [67, 72, 76, 79, 77, 76, 74, 72], [71, -1, 68, 71, 76, -1, 75, 76],
    [81, -1, 79, 77, 76, -1, 72, 76], [77, 76, 74, 72, 69, -1, 72, 74], [76, -1, 79, -1, 76, 74, 72, 71], [68, 71, 76, 80, 81, -1, -1, 0]] },
  fuego: { bpm: 156, roots: [38, 36, 34, 36], chords: [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]], lead: [
    [74, -1, 77, 74, 81, -1, 79, 77], [76, 72, -1, 76, 79, -1, 76, 0], [74, 77, 82, -1, 81, 79, 77, 74], [76, -1, -1, 79, 76, 72, 74, 76],
    [77, 74, 77, 81, 86, -1, 84, 81], [79, -1, 76, 72, 79, -1, 84, -1], [82, 81, 79, 77, 74, 77, 79, 81], [79, -1, 76, -1, 72, 74, 76, -1]] },
  brisa: { bpm: 118, soft: true, roots: [41, 38, 46, 48], chords: [[0, 4, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7]], lead: [
    [77, -1, 76, 77, 81, -1, 79, 77], [74, -1, -1, 72, 74, 77, -1, 0], [70, 74, 77, -1, 79, 77, 74, 70], [72, -1, -1, 74, 76, -1, -1, 0],
    [81, -1, 79, 81, 84, -1, 81, 79], [77, -1, 74, 77, 81, -1, -1, 79], [77, 74, 70, 74, 77, -1, 79, 81], [79, -1, 76, -1, 72, -1, -1, 0]] },
  turbo: { bpm: 168, h16: true, roots: [40, 36, 38, 35], chords: [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]], lead: [
    [76, 79, 83, 79, 76, 79, 83, 86], [84, -1, 83, 81, 79, -1, 76, 0], [74, 78, 81, 78, 74, 78, 81, 86], [83, -1, -1, 81, 78, -1, 75, -1],
    [88, -1, 86, 83, 79, 83, 86, 88], [84, 83, 81, 79, 76, -1, 79, 81], [81, -1, 78, 74, 81, -1, 86, -1], [83, -1, 86, -1, 87, -1, -1, 0]] },
  menu: { bpm: 118, roots: [41, 45, 46, 48], chords: [[0, 4, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7]], lead: [
    [77, -1, 81, -1, 84, -1, 81, 79], [76, -1, -1, 72, 76, -1, 79, -1], [77, -1, 82, -1, 86, -1, 84, 82], [79, -1, -1, -1, 76, -1, 72, 0],
    [77, 79, 81, -1, 84, -1, 86, 84], [81, -1, 79, 76, 72, -1, 76, 79], [82, -1, 81, 79, 77, -1, 74, 77], [79, -1, 76, -1, 72, -1, -1, 0]] },
};
