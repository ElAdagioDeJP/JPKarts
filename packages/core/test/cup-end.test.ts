// Final de copa online/LAN: la última carrera lleva a resultados → podio → sala.
import { describe, expect, test } from 'bun:test';
import { CUPS, isLastCupRace } from '../src/data/tracks';

describe('isLastCupRace', () => {
  test('solo el modo copa puede ser última carrera', () => {
    expect(isLastCupRace('free', 0, 3)).toBe(false);
    expect(isLastCupRace('battle', 0, 3)).toBe(false);
    expect(isLastCupRace('elimination', 0, 3)).toBe(false);
  });
  test('las 3 primeras carreras de cada copa no son la última', () => {
    CUPS.forEach((_c, cup) => {
      for (let r = 0; r < CUPS[cup]!.tracks.length - 1; r++) expect(isLastCupRace('cup', cup, r)).toBe(false);
    });
  });
  test('la 4/4 de cada copa sí es la última (y más allá también)', () => {
    CUPS.forEach((_c, cup) => {
      const last = CUPS[cup]!.tracks.length - 1;
      expect(isLastCupRace('cup', cup, last)).toBe(true);
      expect(isLastCupRace('cup', cup, last + 1)).toBe(true);
    });
  });
  test('copa inexistente nunca es última', () => {
    expect(isLastCupRace('cup', 99, 3)).toBe(false);
    expect(isLastCupRace('cup', -1, 3)).toBe(false);
  });
});
