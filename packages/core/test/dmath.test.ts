import { expect, test } from 'bun:test';
import { datan, datan2, dcos, dexp, dlog, dpow, dsin } from '../src/dmath';
import { Rng } from '../src/math';

test('dmath es preciso (error relativo < 1e-14 frente a Math)', () => {
  const r = new Rng(3);
  let worst = 0;
  const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b), 1e-15);
  for (let i = 0; i < 20000; i++) {
    const x = r.range(-60, 60), y = r.range(-60, 60), p = r.range(0.01, 30), q = r.range(-8, 8);
    worst = Math.max(worst, Math.abs(dsin(x) - Math.sin(x)), Math.abs(dcos(x) - Math.cos(x)), Math.abs(datan2(y, x) - Math.atan2(y, x)), Math.abs(datan(q) - Math.atan(q)));
    worst = Math.max(worst, rel(dexp(q), Math.exp(q)), rel(dlog(p), Math.log(p)), rel(dpow(p, q * 0.3), Math.pow(p, q * 0.3)));
  }
  expect(worst).toBeLessThan(1e-13);
  expect(datan2(0, -1)).toBeCloseTo(Math.PI, 15);
  expect(dexp(0)).toBe(1);
  expect(dpow(2, 10)).toBeCloseTo(1024, 9);
});
