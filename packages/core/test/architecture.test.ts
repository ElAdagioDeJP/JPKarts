import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { effectDefs, itemList } from '../src';

// docs/PLAN.md Fase 3: a mechanic = a file + its registration. updateKart never names items or effects.
test('updateKart no menciona ningún objeto ni efecto por nombre', () => {
  const src = readFileSync(join(import.meta.dir, '../src/sim/world.ts'), 'utf8');
  const start = src.indexOf('function updateKart('), end = src.indexOf('\nfunction ', start + 10);
  const body = src.slice(start, end);
  const names = [...itemList().map((i) => i.id), ...effectDefs().map((d) => d.type)];
  const found = names.filter((n) => new RegExp(`['"\`]${n}['"\`]`).test(body));
  expect(found).toEqual([]);
});

test('añadir un objeto y un efecto nuevos no toca la simulación', () => {
  // separate process: registries are global and would leak into other tests
  const r = Bun.spawnSync(['bun', join(import.meta.dir, 'fixtures/new-mechanic.ts')]);
  const out = JSON.parse(r.stdout.toString().trim().split('\n').pop()!);
  expect(out).toEqual({ used: true, applied: true });
}, 30000);
