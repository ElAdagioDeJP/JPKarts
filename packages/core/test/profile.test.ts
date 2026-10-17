// V3-3: el perfil recuerda el último kart (personaje + piezas). PROFILE_VERSION 2 con migración desde la 1 (regla 11).
import { describe, expect, test } from 'bun:test';
import { CHARS, DEFAULT_LOADOUT, PROFILE, PROFILE_VERSION, loadSave, parseSave, writeSave, type KeyStore, type Profile } from '../src';

const mem = (init: Record<string, string> = {}): KeyStore & { m: Record<string, string> } => {
  const m = { ...init };
  return { m, read: (k) => m[k] ?? null, write: (k, v) => { m[k] = v; } };
};

describe('perfil v2', () => {
  test('la versión es la 2 y un perfil nuevo trae el kart por defecto', () => {
    expect(PROFILE_VERSION).toBe(2);
    const p = PROFILE.fresh();
    expect(p.version).toBe(2);
    expect(p.lastCh).toBe(-1);
    expect(p.lastParts).toEqual(DEFAULT_LOADOUT);
  });
  test('migra un perfil v1 sin perder nombre, id ni tutorial', () => {
    const v1 = JSON.stringify({ version: 1, id: 'abcdef0123456789', name: 'Juan', tutorialDone: true });
    const p = parseSave(PROFILE, v1)!;
    expect(p).not.toBeNull();
    expect(p.version).toBe(2);
    expect(p.name).toBe('Juan');
    expect(p.id).toBe('abcdef0123456789');
    expect(p.tutorialDone).toBe(true);
    expect(p.lastCh).toBe(-1);
    expect(p.lastParts).toEqual(DEFAULT_LOADOUT);
  });
  test('migra también un perfil v0 (sin versión) encadenando 0 → 1 → 2', () => {
    const p = parseSave(PROFILE, JSON.stringify({ name: 'Ana', tutorialDone: false }))!;
    expect(p.version).toBe(2);
    expect(p.name).toBe('Ana');
    expect(p.lastParts).toEqual(DEFAULT_LOADOUT);
  });
  test('guardar y cargar conserva el último kart', () => {
    const st = mem();
    const p: Profile = { ...PROFILE.fresh(), name: 'Eva', lastCh: 7, lastParts: { body: 'rover', wheels: 'mini', wing: 'glider' } };
    writeSave(PROFILE, st, p);
    const back = loadSave(PROFILE, st);
    expect(back.from).toBe('main');
    expect(back.data.lastCh).toBe(7);
    expect(back.data.lastParts).toEqual({ body: 'rover', wheels: 'mini', wing: 'glider' });
  });
  test('un último kart con piezas inexistentes o personaje fuera de rango se rechaza (cae al .bak o al perfil nuevo)', () => {
    const bad1 = JSON.stringify({ ...PROFILE.fresh(), lastParts: { body: 'nope', wheels: 'std', wing: 'wing' } });
    const bad2 = JSON.stringify({ ...PROFILE.fresh(), lastCh: CHARS.length });
    const bad3 = JSON.stringify({ ...PROFILE.fresh(), lastCh: 1.5 });
    for (const raw of [bad1, bad2, bad3]) {
      expect(parseSave(PROFILE, raw)).toBeNull();
      expect(loadSave(PROFILE, mem({ [PROFILE.key]: raw })).from).toBe('fresh');
    }
  });
  test('un perfil de una versión más nueva no se toca', () => {
    expect(parseSave(PROFILE, JSON.stringify({ ...PROFILE.fresh(), version: 3 }))).toBeNull();
  });
});
