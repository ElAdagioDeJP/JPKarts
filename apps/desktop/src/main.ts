// Electron main process: window, embedded LAN server, UDP discovery and settings storage.
import { app, BrowserWindow, ipcMain, Menu, net, protocol } from 'electron';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DISCOVERY_PORT, LAN_PORT } from '@jpkart/core';
import { startServer, type ServerHandle } from '@jpkart/server';

const DEV = process.argv.includes('--dev');
// The client is served through `app://jpkart/` instead of file://: the kart models (.glb) are real files that `fetch` must be able to read,
// and under file:// Chromium refuses it. The scheme is privileged (standard + secure + fetch) so it behaves like https.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
let win: BrowserWindow | null = null;
let server: ServerHandle | null = null;
const beacons = new Map<string, dgram.Socket>();
let beaconTimer: NodeJS.Timeout | null = null;

// IPv4 interfaces, real LAN first: VPN tunnels (/32 masks) and virtual adapters (Hyper-V, WSL, VMs) last.
// Each one carries its directed broadcast, because Windows sends 255.255.255.255 through a single
// interface (a VPN tunnel when one is active), so the beacon never reached the Wi-Fi/Ethernet LAN.
const VIRTUAL = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|TAP|TUN|VPN|WireGuard|ZeroTier|Tailscale|Hamachi/i;
function lanInterfaces(): { address: string; broadcast: string }[] {
  const out: { address: string; broadcast: string; score: number }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if ((a.family !== 'IPv4' && (a.family as unknown) !== 4) || a.internal) continue;
      const ip = a.address.split('.').map(Number), mask = a.netmask.split('.').map(Number);
      const broadcast = ip.map((b, i) => (b | (~mask[i]! & 255)) & 255).join('.');
      const tunnel = a.netmask === '255.255.255.255';
      const score = (tunnel || VIRTUAL.test(name) ? 0 : 10) + (ip[0] === 192 && ip[1] === 168 ? 3 : ip[0] === 10 ? 2 : 1);
      out.push({ address: a.address, broadcast: tunnel ? '' : broadcast, score });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}
const lanAddresses = () => lanInterfaces().map((i) => i.address);

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1280, height: 760, minWidth: 640, minHeight: 400, title: 'JP Kart', backgroundColor: '#1b1740',
    webPreferences: { preload: path.join(app.getAppPath(), 'dist', 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  if (DEV) void win.loadURL('http://localhost:5173/');
  // note: never use __dirname here (bundlers may inline the build machine's path)
  else void win.loadURL('app://jpkart/index.html');
  win.webContents.on('before-input-event', (_e, input) => { if (input.key === 'F11' && input.type === 'keyDown') win!.setFullScreen(!win!.isFullScreen()); });
}

// ---- hosting: embedded server + UDP beacon ----
ipcMain.handle('host:start', (_e, name: string) => {
  if (!server) server = startServer(LAN_PORT, (m) => console.log('[servidor]', m));
  if (!beaconTimer) {
    beaconTimer = setInterval(() => {
      const msg = Buffer.from(JSON.stringify({ jpkart: 1, name: String(name).slice(0, 16), port: LAN_PORT, players: server?.room.players.size ?? 0 }));
      // one socket bound to each interface's address, so every LAN gets the beacon (not only the VPN's)
      for (const i of lanInterfaces()) {
        const s = beacons.get(i.address);
        if (!s) {
          const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
          beacons.set(i.address, sock);
          sock.on('error', () => { sock.close(); beacons.delete(i.address); });
          sock.bind(0, i.address, () => sock.setBroadcast(true));
          continue;
        }
        for (const t of new Set([i.broadcast || '255.255.255.255', '255.255.255.255'])) s.send(msg, DISCOVERY_PORT, t, () => { /* interface gone: ignore */ });
      }
    }, 1000);
  }
  return { port: LAN_PORT, addresses: lanAddresses() };
});
ipcMain.handle('host:stop', () => {
  if (beaconTimer) clearInterval(beaconTimer);
  beaconTimer = null;
  for (const s of beacons.values()) s.close();
  beacons.clear();
  server?.close(); server = null;
  return true;
});

// ---- discovery: listen to beacons for a moment ----
ipcMain.handle('discover', () => new Promise((resolve) => {
  const found = new Map<string, { name: string; address: string; port: number; players: number }>();
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('message', (buf, rinfo) => {
    try {
      const m = JSON.parse(String(buf));
      if (m.jpkart === 1) found.set(rinfo.address, { name: m.name, address: rinfo.address, port: m.port, players: m.players });
    } catch { /* not ours */ }
  });
  sock.on('error', () => resolve([...found.values()]));
  sock.bind(DISCOVERY_PORT, () => setTimeout(() => { sock.close(); resolve([...found.values()]); }, 1600));
}));

// ---- settings / save files in userData (atomic: write .tmp, keep .bak, rename) ----
// `key.bak` reads the backup of `key`; the client validates both and picks (core/src/meta/save.ts)
const store = (key: string) => path.join(app.getPath('userData'), key.replace(/\.bak$/, '').replace(/[^a-z0-9._-]/gi, '_') + '.json' + (key.endsWith('.bak') ? '.bak' : ''));
ipcMain.handle('store:read', (_e, key: string) => {
  try { return fs.readFileSync(store(key), 'utf8'); } catch { return null; }
});
ipcMain.handle('store:write', (_e, key: string, value: string) => {
  const f = store(key);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak');
  fs.writeFileSync(f + '.tmp', value);
  fs.renameSync(f + '.tmp', f);
  return true;
});

function serveRenderer() {
  const root = path.join(app.getAppPath(), 'dist', 'renderer');
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}
app.whenReady().then(() => { if (!DEV) serveRenderer(); createWindow(); });
app.on('window-all-closed', () => { server?.close(); app.quit(); });
