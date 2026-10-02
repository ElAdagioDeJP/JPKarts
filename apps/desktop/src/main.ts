// Electron main process: window, embedded LAN server, UDP discovery and settings storage.
import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DISCOVERY_PORT, LAN_PORT } from '@jpkart/core';
import { startServer, type ServerHandle } from '@jpkart/server';

const DEV = process.argv.includes('--dev');
let win: BrowserWindow | null = null;
let server: ServerHandle | null = null;
let beacon: dgram.Socket | null = null;
let beaconTimer: NodeJS.Timeout | null = null;

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1280, height: 760, minWidth: 640, minHeight: 400, title: 'JP Kart', backgroundColor: '#1b1740',
    webPreferences: { preload: path.join(app.getAppPath(), 'dist', 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  if (DEV) void win.loadURL('http://localhost:5173/');
  // note: never use __dirname here (bundlers may inline the build machine's path)
  else void win.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'));
  win.webContents.on('before-input-event', (_e, input) => { if (input.key === 'F11' && input.type === 'keyDown') win!.setFullScreen(!win!.isFullScreen()); });
}

// ---- hosting: embedded server + UDP beacon ----
ipcMain.handle('host:start', (_e, name: string) => {
  if (!server) server = startServer(LAN_PORT, (m) => console.log('[servidor]', m));
  if (!beacon) {
    beacon = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    beacon.bind(() => {
      beacon!.setBroadcast(true);
      beaconTimer = setInterval(() => {
        const msg = Buffer.from(JSON.stringify({ jpkart: 1, name: String(name).slice(0, 16), port: LAN_PORT, players: server?.room.players.size ?? 0 }));
        beacon?.send(msg, DISCOVERY_PORT, '255.255.255.255');
      }, 1000);
    });
  }
  return { port: LAN_PORT, addresses: lanAddresses() };
});
ipcMain.handle('host:stop', () => {
  if (beaconTimer) clearInterval(beaconTimer);
  beacon?.close(); beacon = null;
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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { server?.close(); app.quit(); });
