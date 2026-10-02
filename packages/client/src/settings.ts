// Player settings (save-systems): versioned JSON with migrations; atomic-ish write with a backup copy.
// Browser: localStorage. Electron (Phase 7) swaps the storage for files in userData.
import type { Action } from './input/input';

export const SETTINGS_VERSION = 1;

export interface Settings {
  version: number;
  volume: { music: number; sfx: number };
  /** screen shake: 1 normal, 0.3 reduced, 0 off */
  shake: number;
  /** limit full-screen flashes */
  reduceFlash: boolean;
  colorblind: boolean;
  /** HUD scale: 1 or 1.5 */
  hudScale: number;
  /** post-processing on/off */
  post: boolean;
  /** drift: hold (default) or toggle */
  driftToggle: boolean;
  keys: Partial<Record<Action, string[]>>;
  pad: Partial<Record<Action, number[]>>;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  volume: { music: 0.8, sfx: 1 },
  shake: 1,
  reduceFlash: false,
  colorblind: false,
  hudScale: 1,
  post: true,
  driftToggle: false,
  keys: {},
  pad: {},
};

/** Migrations v → v+1 (none yet; the chain grows with each schema change). */
const MIGRATIONS: Record<number, (s: any) => any> = {
  0: (s) => ({ ...DEFAULT_SETTINGS, ...s, version: 1 }),
};

export interface Storage { read(key: string): string | null; write(key: string, value: string): void }
export const localStore: Storage = {
  read: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  write: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const KEY = 'jpkart.settings';

export function parseSettings(raw: string | null): Settings | null {
  if (!raw) return null;
  try {
    let s = JSON.parse(raw);
    let v = typeof s.version === 'number' ? s.version : 0;
    if (v > SETTINGS_VERSION) return null; // from a newer build
    while (v < SETTINGS_VERSION) { s = MIGRATIONS[v]!(s); v++; }
    // validate shape against the defaults
    const out = { ...DEFAULT_SETTINGS, ...s, volume: { ...DEFAULT_SETTINGS.volume, ...s.volume } } as Settings;
    if (typeof out.shake !== 'number' || typeof out.post !== 'boolean') return null;
    return out;
  } catch { return null; }
}

export function loadSettings(store: Storage = localStore): Settings {
  return parseSettings(store.read(KEY)) ?? parseSettings(store.read(KEY + '.bak')) ?? structuredClone(DEFAULT_SETTINGS);
}

export function saveSettings(s: Settings, store: Storage = localStore) {
  const prev = store.read(KEY);
  if (prev) store.write(KEY + '.bak', prev);
  const json = JSON.stringify({ ...s, version: SETTINGS_VERSION });
  store.write(KEY, json);
  // desktop app: also a file in userData (atomic write with backup, see apps/desktop)
  (globalThis as { jpkartDesktop?: { write(k: string, v: string): Promise<boolean> } }).jpkartDesktop?.write('settings', json);
}

/** Desktop app: settings file in userData wins over localStorage. */
export async function loadDesktopSettings(): Promise<Settings | null> {
  const d = (globalThis as { jpkartDesktop?: { read(k: string): Promise<string | null> } }).jpkartDesktop;
  return d ? parseSettings(await d.read('settings')) ?? parseSettings(await d.read('settings.bak')) : null;
}
