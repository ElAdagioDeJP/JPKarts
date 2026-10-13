// Retematización tenis → computación (frente 7): cero referencias a tenis/pelota en
// el juego (código + datos). Excepciones: los ids estables `tenis`/`tenis-jp` (guardados),
// el import `tenisJp` y este propio test.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['packages/core/src', 'packages/core/data', 'packages/client/src', 'packages/client/assets'];
const SELF = 'retheme.test.ts';

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.tsx?$/.test(e) || /\.json$/.test(e)) out.push(p);
  }
  return out;
}

test('cero tenis/pelota en juego (ids estables como únicas excepciones)', () => {
  const bad: string[] = [];
  for (const f of ROOTS.flatMap(files)) {
    if (f.endsWith(SELF) || f.endsWith('.test.ts')) continue;
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/tenis/i.test(line) && !/tenis-jp|tenisJp|'tenis'/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
      if (/pelota/i.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  expect(bad).toEqual([]);
});
