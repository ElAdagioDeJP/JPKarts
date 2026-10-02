# JP Kart

Juego de karts pixel art (terreno voxel + sprites) para jugar en LAN y como `.exe` de Windows, con arquitectura lista para online.

## Documentos (leer antes de trabajar)
- `docs/PLAN.md`: fases. **Una fase a la vez**; marca el checklist y verifica la "Definición de terminado" con números.
- `docs/GDD.md`: diseño (conducción, objetos, sistemas, modos, pistas, IA, personajes).
- `docs/ART_BIBLE.md`: arte, render, cámara, HUD, audio, accesibilidad.
- `docs/MECHANICS_BACKLOG.md`: mecánicas numeradas (`#n`), con prioridad y fase.
- `legacy/jp-kart.html`: **referencia de comportamiento**. Las fases 1–3 deben sentirse idénticas a él.

## Arquitectura (monorepo, Bun workspaces)
```
packages/
  core/     # simulación pura y determinista. SIN DOM, canvas, audio ni tiempo real.
    src/{sim,effects,entities,items,modes,tracks,ai,net}/
    data/{tunables,characters,tracks}/   # JSON
  client/   # render Three.js WebGPURenderer (respaldo WebGL2 automático), HUD, menús, audio, input, game feel.
  server/   # servidor autoritativo WebSocket: inputs → core → snapshots.
apps/
  desktop/  # Electron: client + server embebido (LAN).
  web/      # build web del client (opcional).
```

## Reglas obligatorias
1. **Core sin DOM.** Nada de `document`, `window`, `ctx`, `AudioContext`, `Math.random`, `Date.now` ni `performance.now` en `core`. Lo comprueba el lint.
2. **Determinismo.** RNG con semilla inyectada, paso fijo de 60 Hz, sin dependencia del orden de iteración de objetos/Map no ordenados. La misma semilla y los mismos inputs dan el mismo hash.
3. **Estado serializable.** Solo datos planos e **ids** (`KartId`, `EntityId`), nunca referencias a objetos ni funciones en el estado.
4. **Todo es datos + registro.** Objetos (`defineItem`), efectos (`defineEffect`), entidades (`defineEntity`), modos (`defineMode`), personajes y pistas (JSON). Una mecánica nueva = un archivo + su registro. **Prohibido** añadir casos por nombre en `updateKart` o en el bucle de la carrera.
5. **Números en tunables.** Ningún valor de balance o tuning va hardcodeado: va en `core/data/tunables/*.json`.
6. **Core emite eventos; el client hace el feedback.** Sonido, partículas, shake, hit-stop (solo visual), banners. Core nunca llama a audio ni a render.
7. **Sin `player` global.** Cada kart tiene `ctrl: 'local' | 'remote' | 'ai'`; la cámara y el HUD siguen al kart local.
8. **Cada mecánica se entrega con:** test de replay/hash, `aiScore` o consideración de IA, eventos para el feedback, smoke test de red (desde la Fase 6) y su fila en el backlog actualizada.
9. **Rendimiento.** Se respetan los presupuestos de `docs/PLAN.md` (sim ≤ 2 ms/tick, 60 fps con 8 karts en la PC de referencia). No se asigna memoria en el camino caliente del tick: se usan pools. Se mide antes de optimizar.
10. **Red.** Servidor autoritativo:
    - cliente → servidor: inputs `{t,s,d,item,seq}` a 60 Hz;
    - servidor → clientes: snapshots a ~30 Hz;
    - el kart local se predice y se reconcilia; los demás se interpolan;
    - protocolo versionado.

    Puertos: WS 7777, descubrimiento UDP 7778.
11. **Guardado versionado.** Todo archivo persistente lleva `version` y migraciones; la escritura es atómica (`.tmp` + `.bak`).
12. **No romper lo que funciona.** Cada fase termina jugable y con commit. Las pistas legacy siguen jugables ("Clásicas") hasta tener su reemplazo validado.
13. **Textos del juego en español.** Código e identificadores en inglés.
14. **Skills.** Al empezar una fase, carga las skills `gamedev` de su línea "Skills" en el PLAN. No hay engine: se usan conceptos, no APIs.

## Stack
TypeScript estricto, Bun (workspaces, `bun test`), Vite (client), **Three.js con `WebGPURenderer` (obligatorio)**, cuyo respaldo WebGL2 es automático (se fuerza con `?webgl`); efectos con TSL/nodos; `ws` (server), Electron + electron-builder (`.exe`).

## Comandos (se van completando)
- `bun install`
- `bun run dev`: client en el navegador
- `bun test`: tests (incluye replays/hash)
- `bun run bench`: benchmark headless de la simulación
- `bun run validate:tracks`: validador de pistas
- `bun run server`: servidor headless
- `bun run desktop`: Electron en desarrollo
- `bun run dist:win`: genera el `.exe` portable en `apps/desktop/release/`
- `node tools/shot.mjs`, `tools/lan-check.mjs`, `tools/desktop-check.mjs`: pruebas en navegador y en Electron con capturas
- `bun packages/core/tools/ai-balance.ts`: balance de la IA · `bun packages/core/tools/track-info.ts <json>`: métricas de una pista
