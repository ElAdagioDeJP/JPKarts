import { defineConfig, type Plugin } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
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

/** Dev only: the track editor (F3) saves authored tracks here. */
function saveTracks(): Plugin {
  return {
    name: 'jpkart-save-track',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__jpkart/save-track', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const def = JSON.parse(body);
            if (!/^[a-z0-9-]+$/.test(def.id)) throw new Error('id inválido');
            writeFileSync(resolve(__dirname, '../core/data/tracks', def.id + '.json'), JSON.stringify(def, null, 2) + '\n');
            res.end('ok');
          } catch (e) { res.statusCode = 400; res.end(String(e)); }
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [hotTunables(), saveTracks()],
  server: { port: 5173, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
