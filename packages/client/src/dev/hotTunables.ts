// Dev: apply tunables pushed by the Vite plugin (see vite.config.ts) without reloading the page.
import { setTunables, tunablesHash, type TunableGroup } from '@jpkart/core';

export function installHotTunables(onApplied: (msg: string) => void) {
  if (!import.meta.hot) return;
  import.meta.hot.on('jpkart:tunables', ({ group, data }: { group: TunableGroup; data: unknown }) => {
    const errs = setTunables(group, data);
    onApplied(errs.length ? 'Tunables con errores: ' + errs.slice(0, 2).join('; ') : `Tunables "${group}" recargados (${tunablesHash()})`);
  });
  import.meta.hot.on('jpkart:tunables-error', (e: string) => onApplied('JSON inválido: ' + e));
}
