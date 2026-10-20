// Builds the desktop renderer stamping VITE_BUILD_REF (exact tag or short
// commit, `dev` fallback) so the .exe shows the same version as the web.
// Run from apps/desktop: `bun scripts/build-renderer.ts`.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

function buildRef(): string {
  const run = (args: string[]) => {
    try {
      const r = spawnSync('git', args, { encoding: 'utf8' });
      const s = String(r.stdout ?? '').trim();
      return r.status === 0 && s ? s : '';
    } catch {
      return '';
    }
  };
  return run(['describe', '--tags', '--exact-match']) || run(['rev-parse', '--short', 'HEAD']) || 'dev';
}

const root = join(import.meta.dir, '..', '..', '..');
const ref = buildRef();
console.log('VITE_BUILD_REF=' + ref);
const r = spawnSync(
  'bun',
  ['run', '--cwd', join(root, 'packages', 'client'), 'build', '--', '--outDir', join(root, 'apps', 'desktop', 'dist', 'renderer'), '--emptyOutDir'],
  { stdio: 'inherit', env: { ...process.env, VITE_BUILD_REF: ref } },
);
process.exit(r.status ?? 1);
