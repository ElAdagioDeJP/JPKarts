// Local player profile (save-systems): who you are on this device. Versioned like every persistent file.
// `id` identifies the device to the online server (rejoin a race you dropped from); several people may use the same name.
// Data only: the client creates the id (core has no randomness) and decides when to save.
import { cleanPid } from '../net/protocol';
import type { SaveSchema } from './save';

export interface Profile {
  version: number;
  /** random id of this profile (see cleanPid); '' until the welcome screen ran */
  id: string;
  /** the player's name ('' until chosen) */
  name: string;
  /** the welcome tutorial was seen */
  tutorialDone: boolean;
}

export const PROFILE_VERSION = 1;
export const PROFILE_NAME_MIN = 3, PROFILE_NAME_MAX = 12;

/** Name rules shared by the welcome screen and the server: printable, trimmed, 3 to 12 characters. */
export const cleanProfileName = (n: unknown) => (typeof n === 'string' ? n.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, PROFILE_NAME_MAX).trim() : '');
export const validProfileName = (n: string) => n.length >= PROFILE_NAME_MIN && n.length <= PROFILE_NAME_MAX;

const MIGRATIONS: Record<number, (s: any) => any> = {
  0: (s) => ({ ...s, version: 1, id: typeof s.id === 'string' ? s.id : '', name: typeof s.name === 'string' ? s.name : '', tutorialDone: !!s.tutorialDone }),
};

export const PROFILE: SaveSchema<Profile> = {
  key: 'jpkart.profile',
  version: PROFILE_VERSION,
  migrations: MIGRATIONS,
  fresh: () => ({ version: PROFILE_VERSION, id: '', name: '', tutorialDone: false }),
  valid: (s) => !!s && typeof s.id === 'string' && (s.id === '' || cleanPid(s.id) !== undefined) && typeof s.name === 'string' && typeof s.tutorialDone === 'boolean',
};

/** A profile id from 16 random bytes (`bytes` comes from crypto in the client). */
export const profileId = (bytes: ArrayLike<number>) => Array.from(bytes, (b) => (b & 255).toString(16).padStart(2, '0')).join('');
