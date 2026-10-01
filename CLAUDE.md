# JP Kart

Juego de karts pixel art (estilo Mode 7) en canvas. Objetivo: jugable en LAN y como .exe de Windows, con arquitectura lista para online más adelante.

## Estado actual
- `legacy/jp-kart.html`: versión original, todo en un archivo (~1250 líneas). Es la **referencia de comportamiento**: el juego refactorizado debe sentirse idéntico.
- El plan por fases está en `docs/PLAN.md`. Trabaja una fase a la vez y marca las tareas al terminarlas.

## Arquitectura objetivo (monorepo con Bun workspaces)
```
packages/
  core/     # simulación pura: física, IA, objetos, vueltas, pistas. SIN DOM, canvas ni audio.
  client/   # render (canvas), HUD, menús, audio, input. Solo dibuja el estado que recibe.
  server/   # servidor autoritativo WebSocket: recibe inputs, corre core, emite snapshots.
apps/
  desktop/  # Electron: empaqueta client + puede levantar server embebido (modo LAN).
  web/      # build web del client (opcional).
```

## Reglas
- `core` debe correr en Node/Bun sin navegador. Nada de `document`, `window`, `ctx`, `beep()` dentro de core.
- Core emite **eventos** (ej. `{type:'hit', kart}`, `{type:'lap', kart, lap}`) y el client decide qué sonido/banner mostrar.
- Toda aleatoriedad de core pasa por un RNG con semilla inyectada (no `Math.random()` directo).
- Nada de un `player` global en core: cada kart tiene `ctrl: 'local' | 'remote' | 'ai'`. La cámara/HUD siguen al kart local del cliente.
- Paso fijo de simulación (60 Hz) en core, independiente del framerate de render.
- Red: servidor autoritativo. Cliente → servidor: inputs `{t,s,d,item,seq}` a 60 Hz. Servidor → clientes: snapshots a ~30 Hz. Cliente interpola.
- Puerto LAN por defecto: 7777 (WS). Descubrimiento LAN por UDP broadcast en 7778.
- Textos del juego en español.
- Stack: TypeScript, Bun, Vite para el client, `ws` en el server embebido de Electron, electron-builder para el .exe.

## Comandos (se irán completando)
- `bun install`
- `bun run dev` — client en navegador
- `bun run server` — servidor headless
- `bun run desktop` — Electron en desarrollo
- `bun run dist:win` — genera el .exe
