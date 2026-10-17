// One synthesized sound per item (launch) plus the shared hit impact. Heard by distance with stereo pan.
import type { Audio } from '../audio/audio';

interface Layer {
  w: OscillatorType | 'noise';
  f?: number; to?: number; d: number; v: number;
  at?: number; lp?: number; hp?: number; bp?: number; q?: number;
  /** vibrato [Hz, depth in Hz] */
  vib?: [number, number];
}
const o = (w: Layer['w'], f: number, to: number, d: number, v: number, x: Partial<Layer> = {}): Layer => ({ w, f, to, d, v, ...x });

const noises = new WeakMap<AudioContext, AudioBuffer>();
function noiseBuf(AC: AudioContext) {
  let b = noises.get(AC);
  if (!b) {
    b = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = b.getChannelData(0);
    let s = 987654;
    for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x7fffffff) * 2 - 1; }
    noises.set(AC, b);
  }
  return b;
}

/** Play layered voices on the sfx bus. `gain` 0..1 (distance), `pan` −1..1. */
export function playSfx(A: Audio, layers: Layer[], gain: number, pan: number) {
  const AC = A.AC;
  if (!AC || A.muted || gain < 0.03) return;
  const t0 = AC.currentTime, pn = AC.createStereoPanner();
  pn.pan.value = Math.max(-1, Math.min(1, pan)); pn.connect(A.sfx);
  for (const L of layers) {
    const t = t0 + (L.at ?? 0), end = t + L.d;
    const g = AC.createGain(), vol = L.v * gain;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.006, L.d * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, end);
    let head: AudioNode;
    let src: AudioScheduledSourceNode;
    if (L.w === 'noise') {
      const n = AC.createBufferSource(); n.buffer = noiseBuf(AC); n.loop = true; src = n; head = n;
    } else {
      const osc = AC.createOscillator(); osc.type = L.w;
      osc.frequency.setValueAtTime(L.f ?? 440, t);
      if (L.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, L.to), end);
      if (L.vib) {
        const lfo = AC.createOscillator(), lg = AC.createGain();
        lfo.frequency.value = L.vib[0]; lg.gain.value = L.vib[1]; lfo.connect(lg); lg.connect(osc.frequency);
        lfo.start(t); lfo.stop(end + 0.02);
      }
      src = osc; head = osc;
    }
    for (const [type, f] of [['lowpass', L.lp], ['highpass', L.hp], ['bandpass', L.bp]] as const) {
      if (!f) continue;
      const bq = AC.createBiquadFilter(); bq.type = type; bq.frequency.value = f; if (L.q) bq.Q.value = L.q;
      head.connect(bq); head = bq;
    }
    head.connect(g); g.connect(pn);
    src.start(t); src.stop(end + 0.02);
  }
}

const RECIPES: Record<string, (ok: boolean) => Layer[]> = {
  bocina: () => [o('sawtooth', 330, 320, 0.4, 0.07, { lp: 1800 }), o('sawtooth', 415, 405, 0.4, 0.06, { lp: 1800 }), o('sawtooth', 330, 330, 0.3, 0.06, { at: 0.2, lp: 1800 })],
  falsa: () => [o('triangle', 520, 180, 0.28, 0.07), o('square', 90, 60, 0.08, 0.05, { at: 0.26 })],
  turbo3: () => [o('sawtooth', 200, 700, 0.35, 0.05), o('noise', 0, 0, 0.35, 0.05, { bp: 1200, q: 2 })],
  ciego3: () => [o('noise', 0, 0, 0.25, 0.09, { lp: 900 }), o('sine', 300, 90, 0.25, 0.07)],
  ciego: () => [o('noise', 0, 0, 0.22, 0.08, { lp: 1100 }), o('sine', 360, 100, 0.2, 0.06)],
  bumeran: () => [o('triangle', 520, 260, 0.45, 0.06, { vib: [14, 60] }), o('noise', 0, 0, 0.3, 0.025, { hp: 3000 })],
  bumeranR: () => [o('triangle', 260, 520, 0.45, 0.06, { vib: [14, 60] }), o('noise', 0, 0, 0.3, 0.025, { hp: 3000 })],
  iman: () => [o('sine', 220, 880, 0.5, 0.06, { vib: [30, 40] }), o('square', 110, 220, 0.45, 0.025, { lp: 600 })],
  cadena: () => [0, 0.07, 0.14].flatMap((at) => [o('square', 1600, 500, 0.1, 0.045, { at }), o('noise', 0, 0, 0.06, 0.04, { at, hp: 5000 })]),
  hielo: () => [o('sine', 2400, 1200, 0.3, 0.05), o('sine', 3200, 3000, 0.2, 0.03, { at: 0.05 }), o('noise', 0, 0, 0.15, 0.03, { hp: 6000 })],
  humo: () => [o('noise', 0, 0, 0.55, 0.07, { lp: 700 }), o('triangle', 110, 70, 0.4, 0.05)],
  rafaga: () => [0, 0.07, 0.14, 0.21].flatMap((at) => [o('square', 900, 300, 0.05, 0.05, { at }), o('noise', 0, 0, 0.04, 0.04, { at, hp: 2000 })]),
  bala: (ok) => [o('sawtooth', 220, 1100, 0.6, ok ? 0.08 : 0.05), o('noise', 0, 0, 0.5, 0.05, { bp: 1500 }), o('sine', 80, 50, 0.4, 0.08)],
  goma: () => [o('sine', 400, 150, 0.3, 0.07, { vib: [18, 40] }), o('sine', 600, 200, 0.2, 0.05, { at: 0.05 })],
  burbuja: () => [o('sine', 600, 1500, 0.12, 0.07), o('sine', 900, 2100, 0.12, 0.06, { at: 0.1 })],
  nitro: () => [o('sawtooth', 120, 900, 0.5, 0.06), o('noise', 0, 0, 0.45, 0.04, { bp: 2000 }), o('sine', 60, 45, 0.45, 0.09)],
  alquitran: () => [o('triangle', 140, 70, 0.35, 0.08, { vib: [18, 30] }), o('noise', 0, 0, 0.3, 0.05, { lp: 400 })],
  dron: () => [o('square', 500, 900, 0.5, 0.04, { vib: [40, 120], lp: 2500 }), o('noise', 0, 0, 0.4, 0.02, { hp: 4000 })],
  gancho: (ok) => [o('sawtooth', 300, 120, 0.15, 0.06), ...(ok ? [o('sine', 1800, 1700, 0.2, 0.05, { at: 0.1 })] : [])],
  inversor: () => [o('sine', 800, 300, 0.5, 0.06), o('sine', 300, 800, 0.5, 0.06)],
  pem: () => [o('noise', 0, 0, 0.5, 0.09, { lp: 3000 }), o('sawtooth', 70, 40, 0.6, 0.08), o('square', 1800, 200, 0.15, 0.05)],
  jugger: () => [o('square', 110, 60, 0.6, 0.07), o('sawtooth', 55, 50, 0.6, 0.07), o('noise', 0, 0, 0.4, 0.05, { lp: 600 })],
  agujero: () => [o('sawtooth', 400, 40, 0.9, 0.08, { vib: [6, 20] }), o('noise', 0, 0, 0.8, 0.05, { lp: 300 })],
  overclock: () => [o('sawtooth', 100, 1200, 0.6, 0.05), ...[440, 660, 880].map((f, i) => o('triangle', f, f, 0.08, 0.06, { at: i * 0.06 }))],
  forkbomb: () => Array.from({ length: 6 }, (_, i) => o('square', 200 * 1.25 ** i, 200 * 1.25 ** i, 0.06, 0.05, { at: i * 0.05 })),
  antivirus: () => [o('sine', 660, 990, 0.3, 0.06), o('sine', 1320, 1320, 0.3, 0.04, { at: 0.08 })],
  lagspike: () => [o('square', 900, 900, 0.06, 0.05), o('square', 450, 450, 0.06, 0.05, { at: 0.1 }), o('square', 900, 900, 0.05, 0.05, { at: 0.16 }), o('square', 300, 300, 0.1, 0.05, { at: 0.3 }), o('noise', 0, 0, 0.05, 0.05, { at: 0.2, hp: 3000 })],
  cuantico: () => [o('sine', 1200, 300, 0.25, 0.06, { vib: [25, 80] }), o('sine', 1800, 600, 0.25, 0.04, { at: 0.08 })],
  mina: () => [o('triangle', 300, 100, 0.15, 0.08), o('sine', 1000, 1000, 0.05, 0.05, { at: 0.15 })],
  muelle: () => [o('sine', 300, 1200, 0.15, 0.07), o('sine', 1200, 300, 0.15, 0.07, { at: 0.15, vib: [20, 30] })],
  reflector: () => [o('sine', 1500, 1500, 0.06, 0.05), o('sine', 2000, 2000, 0.06, 0.05, { at: 0.06 }), o('sine', 2500, 2500, 0.12, 0.05, { at: 0.12 }), o('sawtooth', 300, 900, 0.2, 0.02)],
};

/** Item launch sound. `dist` in world units from the local kart (0 = own item), `pan` −1..1. */
export function itemSfx(A: Audio, id: string, dist: number, pan: number, ok: boolean) {
  const gain = Math.max(0, 1 - dist / 300) ** 2;
  const make = RECIPES[id];
  playSfx(A, make ? make(ok) : [o('square', 440, 440, 0.1, 0.05)], gain, pan);
}

/** Same sound on every map: a dull thud + crack under the character's groan. */
export function hitImpact(A: Audio, dist: number, pan: number) {
  playSfx(A, [o('sine', 140, 45, 0.22, 0.12), o('noise', 0, 0, 0.18, 0.1, { lp: 1200 }), o('square', 220, 90, 0.08, 0.04)], Math.max(0, 1 - dist / 380) ** 2, pan);
}
