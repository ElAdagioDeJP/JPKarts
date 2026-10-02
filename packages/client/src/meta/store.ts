// Progress and ghosts on disk (docs/GDD.md §9). The format, migrations and unlock rules live in core
// (core/src/meta); this file only moves bytes: localStorage in the browser, userData files in the desktop app.
import { PROGRESS, ghostKey, loadSave, writeSave, type EngineClass, type KeyStore, type Progress, type Replay } from '@jpkart/core';
import { localStore } from '../settings';

interface DesktopStore { read(k: string): Promise<string | null>; write(k: string, v: string): Promise<boolean> }
const desktop = () => (globalThis as { jpkartDesktop?: DesktopStore }).jpkartDesktop;
const memStore = (m: Record<string, string | null>): KeyStore => ({ read: (k) => m[k] ?? null, write: (k, v) => { m[k] = v; } });

/** Browser copy (synchronous, available at boot). */
export function loadProgress(): Progress {
  return loadSave(PROGRESS, localStore).data;
}

/** Desktop app: the userData file (or its .bak) wins over the browser copy. */
export async function loadDesktopProgress(): Promise<Progress | null> {
  const d = desktop();
  if (!d) return null;
  const st = memStore({ [PROGRESS.key]: await d.read('progress'), [PROGRESS.key + '.bak']: await d.read('progress.bak') });
  const r = loadSave(PROGRESS, st);
  return r.from === 'fresh' ? null : r.data;
}

export function saveProgress(p: Progress) {
  const json = writeSave(PROGRESS, localStore, p);
  void desktop()?.write('progress', json);
}

/** Ghost of the record run (a replay: seed + inputs). */
export async function loadGhost(trackId: string, c: EngineClass): Promise<Replay | null> {
  const k = ghostKey(trackId, c);
  const raw = (await desktop()?.read(k)) ?? localStore.read(k);
  try { return raw ? (JSON.parse(raw) as Replay) : null; } catch { return null; }
}

export function saveGhost(trackId: string, c: EngineClass, r: Replay) {
  const k = ghostKey(trackId, c), json = JSON.stringify(r);
  localStore.write(k, json);
  void desktop()?.write(k, json);
}
