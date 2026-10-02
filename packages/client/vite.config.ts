import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const TUNABLES_DIR = resolve(__dirname, '../core/data/tunables');

/** Dev only: editing core/data/tunables/*.json pushes the new values to the running game (no reload). */
function hotTunables(): Plugin {
  return {
    name: 'jpkart-hot-tunables',
    apply: 'serve',
    handleHotUpdate(ctx) {
      const f = ctx.file.replace(/\\/g, '/');
      if (!f.startsWith(TUNABLES_DIR.replace(/\\/g, '/')) || !f.endsWith('.json')) return;
      try {
        const data = JSON.parse(readFileSync(ctx.file, 'utf8'));
        ctx.server.ws.send({ type: 'custom', event: 'jpkart:tunables', data: { group: basename(f, '.json'), data } });
      } catch (e) {
        ctx.server.ws.send({ type: 'custom', event: 'jpkart:tunables-error', data: String(e) });
      }
      return [];
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [hotTunables()],
  server: { port: 5173, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
