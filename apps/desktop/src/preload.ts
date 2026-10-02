// Safe bridge between the game (renderer) and the desktop features (main process).
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('jpkartDesktop', {
  host: (name: string) => ipcRenderer.invoke('host:start', name) as Promise<{ port: number; addresses: string[] }>,
  stopHost: () => ipcRenderer.invoke('host:stop'),
  discover: () => ipcRenderer.invoke('discover') as Promise<{ name: string; address: string; port: number; players: number }[]>,
  read: (key: string) => ipcRenderer.invoke('store:read', key) as Promise<string | null>,
  write: (key: string, value: string) => ipcRenderer.invoke('store:write', key, value) as Promise<boolean>,
});
