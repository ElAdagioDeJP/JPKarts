import { expect, test } from 'bun:test';
import golden from './golden.json';
import { SCENARIOS, runScenario } from './golden';

// Every refactor must keep the observable behavior of the legacy port (docs/PLAN.md, Fase 3).
SCENARIOS.forEach((sc, i) => {
  test(`trayectoria dorada ${i}: pista ${sc.track}, semilla ${sc.seed}`, () => {
    const got = runScenario(sc);
    const exp = (golden as string[][])[i]!;
    const firstDiff = got.findIndex((h, j) => h !== exp[j]);
    expect(firstDiff).toBe(-1);
  }, 30000);
});
