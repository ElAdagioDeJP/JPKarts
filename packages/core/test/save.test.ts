// Phase 9: versioned saves. A v1 progress file migrates to the current version; a corrupt file recovers its .bak.
import { expect, test } from 'bun:test';
import { ALL_TRACKS, CUPS, PROGRESS, PROGRESS_VERSION, classUnlocked, cupUnlocked, loadSave, recordCup, recordRace, writeSave, type KeyStore } from '../src';

const memStore = (init: Record<string, string> = {}): KeyStore & { m: Record<string, string> } => {
  const m = { ...init };
  return { m, read: (k) => m[k] ?? null, write: (k, v) => { m[k] = v; } };
};

test('un guardado v1 migra a la versión actual', () => {
  const praderaIdx = ALL_TRACKS.findIndex((t) => t.id === 'pradera-jp');
  const v1 = { version: 1, trophies: { hoja: 'oro', estrella: 'bronce' }, bestLaps: { [praderaIdx]: 51.2 } };
  const st = memStore({ [PROGRESS.key]: JSON.stringify(v1) });
  const { data, from } = loadSave(PROGRESS, st);
  expect(from).toBe('main');
  expect(data.version).toBe(PROGRESS_VERSION);
  expect(data.cups['hoja:100']).toBe(1);
  expect(data.cups['estrella:100']).toBe(3);
  expect(data.records['pradera-jp:100']!.lap).toBe(51.2);
  expect(cupUnlocked(data, 2)).toBe(true); // podium in Estrella opens Rayo
  expect(cupUnlocked(data, 3)).toBe(false);
});

test('un guardado corrupto recupera el .bak', () => {
  const st = memStore();
  const p = PROGRESS.fresh();
  recordRace(p, 'pradera-jp', '100', 3, 50.5, 160);
  writeSave(PROGRESS, st, p);
  recordRace(p, 'pradera-jp', '100', 3, 49.9, 158);
  writeSave(PROGRESS, st, p); // the previous good file is now the .bak
  st.m[PROGRESS.key] = st.m[PROGRESS.key]!.slice(0, 20); // truncated write
  const { data, from } = loadSave(PROGRESS, st);
  expect(from).toBe('bak');
  expect(data.records['pradera-jp:100']!.lap).toBe(50.5);
  // neither file usable → fresh progress, never a crash
  st.m[PROGRESS.key + '.bak'] = '{"version": 99}';
  expect(loadSave(PROGRESS, st).from).toBe('fresh');
});

test('desbloqueos: 150cc con oro en las 4 copas a 100cc, Espejo con oro a 150cc', () => {
  const p = PROGRESS.fresh();
  expect(classUnlocked(p, '150')).toBe(false);
  let msgs: string[] = [];
  CUPS.forEach((_, i) => { msgs = recordCup(p, i, '100', 1); });
  expect(classUnlocked(p, '150')).toBe(true);
  expect(msgs).toContain('150cc desbloqueado');
  expect(classUnlocked(p, 'espejo')).toBe(false);
  CUPS.forEach((_, i) => recordCup(p, i, '150', 1));
  expect(classUnlocked(p, 'espejo')).toBe(true);
  // a worse result never replaces a better one
  recordCup(p, 0, '100', 5);
  expect(p.cups['hoja:100']).toBe(1);
});
