// Utilidades móviles puras (M0/M2/M4): detección, haptics, portapapeles, orientación y PWA.
// Todo lo que toca DOM/navigator está guardado para Bun/SSR: importar este módulo nunca falla en tests.
export type QualityTier = 'alta' | 'ahorro';

/** ¿Dispositivo táctil/móvil? Heurística conservadora: coarse pointer, toques o UA móvil. */
export function isMobileDevice(): boolean {
  try {
    if (typeof navigator === 'undefined') return false;
    const nav = navigator as Navigator & { maxTouchPoints?: number; userAgent?: string };
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      try {
        if (window.matchMedia('(pointer: coarse)').matches) {
          // Móvil real o emulación táctil: basta el puntero grueso (con o sin UA móvil).
          if (((nav.maxTouchPoints ?? 0) > 0) || /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent ?? '')) return true;
        }
      } catch { /* noop */ }
    }
    if ((nav.maxTouchPoints ?? 0) > 0 && /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent ?? '')) return true;
    return /Android|iPhone|iPad|iPod/i.test(nav.userAgent ?? '');
  } catch { return false; }
}

/** Vibración táctil (game-feel M1/M4). Patrón en ms. Devuelve si se vibró. */
export function buzz(pattern: number | number[]): boolean {
  try {
    const nav = navigator as Navigator & { vibrate?: unknown };
    const v = nav.vibrate;
    if (typeof v !== 'function') return false;
    return !!(v as (p: number | number[]) => boolean).call(nav, pattern);
  } catch { return false; }
}

/** Intenta fijar landscape tras el primer gesto (puede fallar sin fullscreen: se ignora). */
export function lockLandscape(): void {
  try {
    const so = (screen as Screen & { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
    void so?.lock?.('landscape')?.catch?.(() => {});
  } catch { /* el overlay portrait cubre este caso */ }
}

export async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
}

export async function pasteText(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch { return ''; }
}

/** Registra el service worker solo en móvil + contexto seguro (https o localhost). */
export function registerSW(): void {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (!isMobileDevice()) return;
    const proto = typeof location !== 'undefined' ? location.protocol : '';
    const host = typeof location !== 'undefined' ? location.hostname : '';
    const secure = proto === 'https:' || host === 'localhost' || host === '127.0.0.1';
    if (!secure) return;
    void (navigator as Navigator & { serviceWorker: { register(u: string): Promise<unknown> } }).serviceWorker
      .register('./sw.js')
      .catch(() => {});
  } catch { /* PWA opcional */ }
}

/** HUD efectivo: en móvil nunca por debajo de 1.25× (legible a 30 cm; a 1.5× la lista de 8 pilotos no cabía). */
export function effectiveHudScale(base: number): number {
  return isMobileDevice() ? Math.max(base, 1.25) : base;
}

/** Tier inicial: `quality` manual gana; `auto` = ahorro en móvil, alta en PC. */
export function initialTier(quality: 'auto' | QualityTier): QualityTier {
  if (quality === 'alta' || quality === 'ahorro') return quality;
  return isMobileDevice() ? 'ahorro' : 'alta';
}
