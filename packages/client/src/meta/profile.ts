// The local profile on disk: localStorage in the browser, userData file in the desktop app (same pattern as progress).
import { PROFILE, loadSave, profileId, writeSave, type KeyStore, type Profile } from '@jpkart/core';
import { localStore } from '../settings';

interface DesktopStore { read(k: string): Promise<string | null>; write(k: string, v: string): Promise<boolean> }
const desktop = () => (globalThis as { jpkartDesktop?: DesktopStore }).jpkartDesktop;
const memStore = (m: Record<string, string | null>): KeyStore => ({ read: (k) => m[k] ?? null, write: (k, v) => { m[k] = v; } });

export function loadProfile(): Profile {
  return loadSave(PROFILE, localStore).data;
}

/** Desktop app: the userData file (or its .bak) wins over the browser copy. */
export async function loadDesktopProfile(): Promise<Profile | null> {
  const d = desktop();
  if (!d) return null;
  const r = loadSave(PROFILE, memStore({ [PROFILE.key]: await d.read('profile'), [PROFILE.key + '.bak']: await d.read('profile.bak') }));
  return r.from === 'fresh' ? null : r.data;
}

export function saveProfile(p: Profile) {
  const json = writeSave(PROFILE, localStore, p);
  void desktop()?.write('profile', json);
}

export function newProfileId(): string {
  const b = new Uint8Array(16);
  try { crypto.getRandomValues(b); } catch { for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
  return profileId(b);
}
