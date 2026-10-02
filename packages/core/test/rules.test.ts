import { expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// CLAUDE.md rule 1: core has no DOM, no audio, no wall-clock and no unseeded randomness.
// Math.sin/cos/... differ between engines: core must use dmath (deterministic).
const FORBIDDEN = [/Math\.(sin|cos|tan|atan|atan2|exp|log|pow|hypot)\(/, /\bdocument\b/, /\bwindow\b/, /\bAudioContext\b/, /Math\.random/, /Date\.now/, /performance\.now/, /\bCanvasRenderingContext2D\b/, /\brequestAnimationFrame\b/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

test('core no usa DOM, audio, reloj real ni Math.random', () => {
  const bad: string[] = [];
  for (const f of files(join(import.meta.dir, '../src'))) {
    if (f.endsWith('dmath.ts')) continue;
    const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const re of FORBIDDEN) if (re.test(src)) bad.push(`${f}: ${re}`);
  }
  expect(bad).toEqual([]);
});
