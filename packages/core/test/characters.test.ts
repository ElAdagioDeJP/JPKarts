// Refactor MK7: los visuales derivados siempre están resueltos y el slot Mii existe pero inactivo.
import { describe, expect, test } from 'bun:test';
import { CHARS, isMii } from '../src/data/characters';

describe('personajes MK7 + base Mii', () => {
  test('8 pilotos con visuales resueltos', () => {
    expect(CHARS.length).toBe(8);
    for (const c of CHARS) {
      expect(c.suit).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.glove).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.boot).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.eye).toMatch(/^#[0-9a-f]{6}$/);
      expect([0.92, 1, 1.08]).toContain(c.visualScale);
      expect(c.weightClass).toBe(c.st.pes < 5 ? 'ligero' : c.st.pes >= 8 ? 'pesado' : 'medio');
      // Mii inactivo: el rig debe tolerar su ausencia
      expect(isMii(c)).toBe(false);
      expect(c.mii ?? null).toBeNull();
    }
  });
  test('la escala visual sigue a la clase de peso', () => {
    for (const c of CHARS) {
      const want = c.weightClass === 'ligero' ? 0.92 : c.weightClass === 'pesado' ? 1.08 : 1;
      expect(c.visualScale).toBe(want);
    }
  });
});
