// Build identity (web y .exe idénticos): protocolo + tunables (lo comprueba el
// servidor al conectar) más la ref del build (tag o commit) estampada con
// VITE_BUILD_REF en `bun run build` y en `bun run dist:win`.
import { PROTOCOL_VERSION } from '@jpkart/core';

const REPO = 'https://github.com/ElAdagioDeJP/JPKarts';

/** Tag (v*) o commit corto del que salió este build; `dev` si no se estampó. */
export const BUILD_REF: string =
  ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_BUILD_REF || 'dev').slice(0, 32);

/** Lo que se muestra en título y opciones: `v7 · v0.2.0` o `v7 · dev-a1b2c3d`. */
export const GAME_VERSION = `v${PROTOCOL_VERSION} · ${BUILD_REF}`;

/** true cuando este build salió de un tag: el .exe de ese tag es idéntico. */
export const isTaggedBuild = /^v\d/.test(BUILD_REF);

/** Página de descarga del .exe: el tag exacto cuando se conoce, `latest` si no. */
export function exeDownloadUrl(): string {
  return isTaggedBuild ? `${REPO}/releases/tag/${BUILD_REF}` : `${REPO}/releases/latest`;
}
