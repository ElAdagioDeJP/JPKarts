# Plan JP Kart → LAN + .exe

Cada fase termina con el juego funcionando. Prompt sugerido para Claude Code al inicio de cada fase.

## Fase 1 — Proyecto y módulos (sin cambiar el comportamiento)
> "Lee CLAUDE.md y legacy/jp-kart.html. Haz la Fase 1 de docs/PLAN.md."
- [ ] Monorepo Bun + TypeScript + Vite; `bun run dev` abre el juego.
- [ ] Partir el HTML en módulos: sprites/pixel art, personajes, objetos, pistas, render, HUD, audio, input, menús.
- [ ] Incluir la fuente Press Start 2P localmente (sin Google Fonts) para que funcione offline.
- [ ] Verificar que se juega igual que `legacy/jp-kart.html`.

## Fase 2 — Separar core del client
> "Haz la Fase 2 de docs/PLAN.md."
- [ ] Mover física, IA, objetos, choques, vueltas y generación de pistas a `packages/core`.
- [ ] Quitar el `player` global: `ctrl` por kart; rubber-band de la IA respecto al mejor humano.
- [ ] Sonidos/banners vía eventos de core.
- [ ] RNG con semilla; paso fijo 60 Hz.
- [ ] Test: correr una carrera solo-IA en Bun sin navegador.

## Fase 3 — Servidor y red
> "Haz la Fase 3 de docs/PLAN.md."
- [ ] `packages/server`: WebSocket, salas, lobby (elegir personaje, listo, anfitrión elige pista/copa), IA rellena hasta 8.
- [ ] Protocolo de inputs y snapshots; interpolación en el client.
- [ ] Probar 2 navegadores contra `bun run server` en la misma PC.

## Fase 4 — Electron + .exe
> "Haz la Fase 4 de docs/PLAN.md."
- [ ] `apps/desktop`: menú Crear partida (levanta server embebido) / Unirse (IP o descubrimiento UDP).
- [ ] electron-builder → `.exe` portable.
- [ ] GitHub Actions en `windows-latest` que genere el .exe en cada push/tag.

## Fase 5 (opcional) — Online
- [ ] Dockerfile del server, desplegar en Hetzner con Dokploy (Traefik + WSS).
- [ ] Opción "Online" en el menú con código de sala.
