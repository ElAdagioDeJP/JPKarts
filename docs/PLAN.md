# Plan JP Kart v2

Objetivo: llevar el legacy (`legacy/jp-kart.html`) a un juego escalable con muchas mecánicas nuevas, IA por capas, pistas autoradas largas y dinámicas, render mejorado, LAN y `.exe`.

Documentos:
- `docs/GDD.md`: qué es el juego.
- `docs/ART_BIBLE.md`: cómo se ve y suena.
- `docs/MECHANICS_BACKLOG.md`: qué mecánicas hay, con prioridad y fase.
- `CLAUDE.md`: reglas obligatorias.

## Cómo se trabaja
- **Una fase a la vez.** Cada fase termina **jugable**, con commit, checklist marcado aquí y su "Definición de terminado" verificada (con números, no "debería").
- Al empezar una fase, el agente **carga las skills** de su línea "Skills". Son del plugin `gamedev`; no hay engine, así que se usan sus conceptos y no sus APIs.
- Toda mecánica nueva cumple la definición de terminado de `MECHANICS_BACKLOG.md`: datos + registro, tunables, eventos, test de replay y `aiScore`.
- Si una tarea no cabe en la fase, se anota en el backlog. No se mete a la fuerza.

## Presupuestos de rendimiento (obligatorios desde la Fase 2)

**PC de referencia "modesta":** CPU 4 núcleos de ~2018 (i5-8250U / Ryzen 3 3200U), GPU integrada (UHD 620 / Vega 5), 8 GB, Chrome/Electron actual.

| Presupuesto (60 fps = 16,67 ms) | Límite | Cómo se mide |
|---|---|---|
| Tick de simulación completo (8 karts, 256 entidades) | **≤ 2,0 ms** | `bun run bench` (headless, p95 de 10.000 ticks) |
| — de ello, IA (7 karts) | ≤ 0,8 ms | bench, desglose por sistema |
| — de ello, entidades + colisiones | ≤ 0,5 ms | bench |
| Render CPU (preparación + envío) Three.js WebGPU | ≤ 4 ms | overlay de rendimiento (F2), p95 |
| Render GPU a 640×360 interno | ≤ 8 ms | `renderer.info` / timestamp queries de WebGPU; si no, el fps |
| Respaldo WebGL2 de Three (frame completo) | ≤ 22 ms (≥ 45 fps) | overlay con `?webgl` |
| Serializar snapshot (servidor) | ≤ 0,3 ms | bench de red |
| Reservas del sistema | entidades 256 · partículas 1024 (WebGPU) / 512 (WebGL2) · proyectiles 64 | asserts en dev |
| Asignaciones en el tick de sim | **0** en el camino caliente | bench con `--track-alloc` (heap antes/después) |

Si una fase supera un presupuesto, no se cierra: se perfila, se arregla el mayor coste y se vuelve a medir (`performance-optimization`).

## Skills sin cobertura (avisado)
- **Netcode genérico:** `godot-multiplayer` y `roblox-networking` son de engine concreto. Para la red se usan `physics-tuning` (paso fijo, interpolación) y `performance-optimization`. El diseño de predicción y reconciliación sale de este plan.
- **Electron y empaquetado:** no hay skill. `itch-publish` sirve si algún día se publica en itch.io.

---

## Fase 1 — Monorepo y port a TS (core/client), comportamiento idéntico
**Objetivo:** el legacy portado a TypeScript, ya separado en `core` (sin DOM) y `client`, jugándose igual que `legacy/jp-kart.html`.
**Skills:** `router`, `performance-optimization` (solo para medir la línea base).
- [x] Monorepo con Bun workspaces: `packages/core`, `packages/client` (Vite), tsconfig estricto, `bun test`. La regla "core sin DOM/`Math.random`/reloj real" la hace cumplir un test (`core/test/rules.test.ts`) y `core` compila sin la lib DOM.
- [x] Partir el legacy por responsabilidad:
  - `core`: pistas (gen + build de heightmap), karts, objetos (ya en registro `defineItem`), IA, vuelta, ranking.
  - `client`: pixel art, **render Three.js `WebGPURenderer`** (decisión obligatoria del dueño; respaldo WebGL2 automático), HUD, menús, audio, input.
- [x] Quitar `player` global: cada kart tiene `ctrl: 'local' | 'remote' | 'ai'`. Cámara y HUD siguen al kart local.
- [x] `beep()`, `banner` y `flash()` salen de core: core emite eventos y el client hace sonido y banner.
- [x] Fuente Press Start 2P local (`@fontsource/press-start-2p`).
- [x] Medir la línea base. **Port en la PC de desarrollo (Edge):** WebGPU 60 fps, sim 0,2–0,4 ms/frame, render CPU 3–7 ms; WebGL2 60 fps, render CPU ~10 ms. El legacy no expone métricas (IIFE cerrada); falta medir en la PC de referencia.
- Adelantado de la Fase 2: RNG con semilla, paso fijo de 60 Hz e ids en vez de referencias. Cuesta lo mismo hacerlo al portar.

**Terminado cuando:**
- `bun run dev` abre el juego y se juegan las 16 pistas en Carrera y Copa. ✅ (lo comprueba `tools/shot.mjs` en Edge: título → selección → carrera, WebGPU y WebGL2)
- Comparación lado a lado con el legacy: misma pista y personaje, los tiempos de vuelta del humano están dentro de ±3 %. ⏳ **Pendiente de prueba humana.** Automático: la IA termina 3 vueltas en 1:40–3:00 (`core/test/race.test.ts`), coherente con la vuelta de ~43 s del legacy.
- `core` compila sin la lib DOM. ✅
- La línea base está anotada. ✅

> Prompt: "Lee CLAUDE.md, docs/PLAN.md y legacy/jp-kart.html. Ejecuta la Fase 1."

## Fase 2 — Determinismo, replays y tests de hash
**Objetivo:** `core` 100 % determinista y medible; poder grabar y reproducir carreras.
**Skills:** `physics-tuning`, `save-systems`, `performance-optimization`, `procedural-gen` (RNG con semilla).
- [x] RNG con semilla inyectada (`Rng`, mulberry32, estado serializable); cero `Math.random` en core (lo comprueba un test).
- [x] Paso fijo de 60 Hz con acumulador (máx. 5 sub-pasos por frame). El render interpola posición y ángulo.
- [x] **Ids en vez de referencias** (`owner`, `target`, `hookTg`). Estado serializable a JSON plano (`snapshot`).
- [x] **Matemática determinista (`dmath`)**: `Math.sin/cos/atan2/exp/pow` daban bits distintos en Bun (JSC) y en V8. Se portaron de fdlibm usando solo operaciones IEEE básicas; un test prohíbe `Math.sin` y compañía en core.
- [x] Inputs cuantizados a 8 bits por eje (`quantizeInput`): mismo valor en todos los pares y replays compactos.
- [x] Replay = `{version, cfg, ticks, inputs (solo cambios), hashes}`, `ReplayRecorder` y `playReplay` headless. El client graba cada carrera.
- [x] Hash del estado (FNV-1a sobre el JSON del snapshot) cada 60 ticks.
- [x] `bun run bench`: 8 IA en 4 pistas, con p50/p95/max. El desglose por sistema queda para la Fase 3, con los pools.
- [ ] Reajustar el tuning con el paso fijo comparando con el legacy. ⏳ Necesita prueba humana; las constantes del legacy se mantuvieron sin cambios.

**Terminado cuando:**
- Test: la misma semilla y los mismos inputs dan el **mismo hash final** en 3 ejecuciones y en Bun y Chrome. ✅ (`replay.test.ts`; `tools/crossengine.sh` compara Bun/JSC con Node/V8: idéntico)
- Un replay grabado en el navegador se reproduce headless con el mismo hash. ✅ (`tools/shot.mjs` lo graba en Edge y `core/tools/replay-check.ts` lo reproduce en Bun: mismo hash)
- Bench dentro del presupuesto de sim. ✅ p95 0,045 ms/tick (presupuesto 2 ms) en la PC de desarrollo.
- Carrera solo-IA completa en Bun sin navegador. ✅
- Nota: la IA legacy no siempre termina en Volcán Rugiente (cae a la lava). Se corrige con la IA por capas de la Fase 4.

> Prompt: "Ejecuta la Fase 2 de docs/PLAN.md."

## Fase 3 — Arquitectura de mecánicas
**Objetivo:** que añadir una mecánica sea crear un archivo y registrarlo. Los 15 objetos legacy migrados **sin cambiar su comportamiento**.
**Skills:** `physics-tuning`, `game-feel` (contrato de eventos → feedback), `input-systems` (acciones), `save-systems` (versionado de tunables), `performance-optimization` (pools).
- [x] Sistema de efectos `defineEffect` (`core/src/sim/effects.ts` + `effectDefs.ts`): tags, `blocks` (inmunidades), permanentes, `cancelOnHit` y hooks del pipeline (`input`, `noBoost`, `speed` con orden, `absorbHit`, `bumpScale`, `onBump`, `bumpPush`, `onWorldBounds`, `onOffRoad`). Los 11 campos sueltos del kart pasan a `kart.fx` (#2). Decisión: `spin`, `boost` y `respawn` siguen siendo estado cinemático del kart, no efectos.
- [x] Lista única de entidades `defineEntity` (`entities.ts`): `fake`, `tar`, `shot`, `rocket`, `hole`, con zonas (`zone` + `zoneEffect`) y comportamiento ante el agujero negro como datos (#3). Pools y spatial hash: **no hacen falta todavía** (bench p95 0,07 ms/tick; `nearestFull` solo se llama cuando un kart se pierde). Se retoman si el bench se acerca al presupuesto.
- [x] Bus de eventos tipado. El client presenta los efectos con una tabla de datos (`client/src/feel/effectView.ts`: etiqueta, HUD y prioridad) (#4). Los presets de feedback pequeño/medio/grande (shake, hit-stop) llegan con la Fase 5.
- [x] `defineItem` y migración de los 15 objetos, **un archivo por objeto** en `core/src/items/`. El orden de importación define el tier (#5).
- [x] `defineMode` con Carrera y Copa (`modes.ts`: `endCondition` + `scoring`). La copa del client suma puntos con `scoring` (#6).
- [x] Tunables en `core/data/tunables/{driving,items,race}.json` con validación de forma (`validateTunables`), `tunablesHash()` para la red y **recarga en caliente** en dev (plugin de Vite + `setTunables`, verificado con `tools/hot-tunables-check.mjs`) (#7).
- [x] Personajes en `core/data/characters.json` (stats, colores, personalidad).

**Terminado cuando:**
- Los replays grabados en la Fase 2 **dan el mismo hash** tras la migración (o la diferencia está explicada y aprobada). ✅ El hash del snapshot cambia a la fuerza (otra forma de los datos), así que se usan **trayectorias doradas**: 6 escenarios, 90 s cada uno, con los 15 objetos usados ≥ 15 veces. El hash de comportamiento (posiciones, velocidades, objetos, entidades, RNG) es **idéntico bit a bit** antes y después (`test/golden.test.ts`).
- `updateKart` no menciona ningún objeto ni efecto por nombre. ✅ (`test/architecture.test.ts`)
- Añadir un objeto de prueba solo toca su archivo y una línea de registro. ✅ (`test/fixtures/new-mechanic.ts`: efecto + objeto nuevos sin tocar la simulación)
- Bench dentro del presupuesto. ✅ p95 0,072 ms/tick.

> Prompt: "Ejecuta la Fase 3 de docs/PLAN.md."

## Fase 4 — Vertical slice A: jugabilidad (greybox)
**Objetivo:** probar de punta a punta la nueva jugabilidad en **una pista autorada: Playa Coco v2**. Cubre marea entre vueltas, agua (caída), olas temporizadas y un atajo con riesgo. Arte en greybox: sirve el del legacy.
**Skills:** `prototype-fast`, `physics-tuning`, `input-systems`, `game-ai`, `ai-behavior-trees-utility-ai`, `level-design`, `procedural-gen`.
- [x] Brief de prototipo (`prototype-fast`):
  - **Pregunta:** ¿la conducción v2 + IA por capas + una pista con intención de diseño hacen las carreras más ricas sin perder la sencillez del legacy?
  - **Quedarse si:** la IA completa la pista sola, el humano de referencia gana a veces sin ganar siempre (top 4 en 40–70 %), y cada mecánica nueva aparece en una carrera normal.
  - **Descartar/ajustar si:** la IA se atasca, una mecánica no ocurre nunca o domina la carrera.
  - **Timebox:** una sesión. Resultado: **quedarse**; el ajuste fino queda para el playtest humano.
- [x] Formato de pista autorada + bake (#34): `core/data/tracks/*.json` (spline centrípeta, secciones con intención, muros, superficies, rampas, atajos, peligros, agua), constructor en `core/src/track/authored.ts`. Atajos reales (#39): el muelle ahorra ~1,3 s. Editor/visor debug (#36): **F3** (vista cenital, arrastrar puntos de control y guardar con S, vía el servidor de dev). Validador (#35): `bun run validate:tracks`.
- [x] Conducción v2 (#10–#17): drift de 3 niveles (azul/naranja/morado), turbo de salida por ventanas + quemar rueda, trucos en el despegue, rebufo, muros con rebote y aturdimiento, golpes leve/normal/fuerte con invulnerabilidad 1 s y recuperación activa, superficies (arena, barro, charco), clases de peso en choques y recuperación. Además: **recuperación por atasco** (la IA a los 3 s, el humano a los 6 s).
- [x] Reparto de objetos v2 (#8): enfriamiento global de tier alto, sin repetición y el líder sin objetos fuertes. `incoming` (#9) + indicador en el HUD.
- [x] **3 objetos nuevos:** Muelle (#19), Mina (#20), Escudo Reflector (#21). Ya son 18 objetos.
- [x] IA por capas (#43–#48): racing line de mínima curvatura, velocidad objetivo según la tasa de giro de cada kart con frenada anticipada, táctica utility a 5 Hz con histéresis (adelantar, bloquear, esquivar, rebufo, atajos), drift y trucos, errores simulados, `aiScore` por objeto, personalidades (JSON), dificultad por kart, rubber-band acotado (±3–6 %, apagado en el último 15 %). Overlay **F4**.
- [x] Peligro temporizado (olas con aviso de 1,2 s, #37) y marea que sube por vuelta del líder (#38). El agua se dibuja como plano animado a su nivel.

**Terminado cuando:**
- Playa Coco v2 pasa el validador: la IA difícil completa 3 vueltas con 3 semillas y la vuelta media cae en 50–60 s. ✅ 51,5 s.
- Cada mecánica nueva tiene test de replay. ✅ Escenario dorado sobre Playa Coco v2 (trayectoria bloqueada bit a bit) + `test/mechanics.test.ts`, que exige marea, olas, muros, trucos, rebufo, drift, turbo de salida, incoming, muelle, mina, reflector y explosión. Más un test de drift de nivel 3.
- La IA Normal termina en el top 4 en el 40–70 % de 20 carreras simuladas, contra una IA "humano de referencia" (Difícil sin rubber-band). ✅ El humano de referencia queda top 4 en el **50 %** (`core/tools/ai-balance.ts`).
- Playtest con ≥ 2 personas sin explicarles nada, con una decisión quedarse/descartar/ajustar anotada por mecánica. ⏳ **Pendiente de prueba humana** (no se puede automatizar).
- Bench dentro del presupuesto. ✅ p95 0,075 ms/tick.

> Prompt: "Ejecuta la Fase 4 de docs/PLAN.md siguiendo el orden de ataque de docs/MECHANICS_BACKLOG.md."

## Fase 5 — Vertical slice B: presentación
**Objetivo:** Playa Coco v2 con la calidad final. Es la referencia visual y sonora de todo lo demás.
**Skills:** `create-game-assets`, `shader-programming`, `camera-systems`, `game-feel`, `game-ui-ux`, `audio-design`, `input-systems`, `performance-optimization`.
- [ ] Resolución 16:9 (640×360 mundo, 320×180 UI) con escalado entero (ART §2).
- [ ] Render Three.js WebGPU v2 (ya existe la base de la Fase 1):
  - decorado instanciado en atlas (de ~650 draw calls a < 10);
  - cadena de post-proceso con TSL/nodos (ART §5);
  - agua animada y detalle cercano del suelo.
- [ ] El respaldo WebGL2 de Three cumple ≥ 45 fps.
- [ ] Paleta y LUT del bioma `sand`, kart voxel a 32 rotaciones con estados animados y sombras.
- [ ] Partículas por eventos (#50), cámara v2 (#51), HUD v2 y pila de pantallas (#52).
- [ ] Mando + acciones + remapeo (#53). Audio por buses, música adaptativa y motores posicionales (#54). Accesibilidad (#55).

**Terminado cuando:**
- 60 fps estables (p95 ≤ 16,7 ms) con 8 karts en la PC de referencia (WebGPU), y ≥ 45 fps con el respaldo WebGL2.
- Legibilidad: rival a 400 u ≥ 12 px y objetos reconocibles en la prueba daltónica.
- Se juega la pista completa solo con mando.
- **Revisión de dirección de arte aprobada por el dueño del proyecto.** Sin esa aprobación no empieza la producción (Fase 8).

> Prompt: "Ejecuta la Fase 5 de docs/PLAN.md. Lee docs/ART_BIBLE.md antes de empezar."

## Fase 6 — Red LAN con predicción del kart local
**Objetivo:** 2–8 humanos en LAN con servidor autoritativo.

Va **antes** de la producción de contenido: así cada mecánica nueva se valida en red cuando se crea, y no hay que volver a probar 30 mecánicas al final.

**Skills:** `physics-tuning`, `performance-optimization`, `input-systems`.
- [ ] `packages/server`: WebSocket (puerto 7777), salas y lobby (personaje, listo, el anfitrión elige pista/copa/modo/clase/reglas de objetos). La IA rellena hasta 8.
- [ ] Protocolo versionado:
  - handshake con `protocolVersion` y hash de los tunables/datos (si no coinciden, se rechaza la conexión con un mensaje en español);
  - inputs `{t,s,d,item,seq}` a 60 Hz;
  - snapshots a 30 Hz con delta respecto al último confirmado.
- [ ] Client:
  - **predicción del kart local + reconciliación** (re-simula desde el último snapshot con los inputs no confirmados);
  - interpolación de los demás karts (buffer de 100 ms);
  - los objetos y entidades los crea el servidor, con eco local inmediato del uso del objeto.
- [ ] Smoke test de red en CI: 2 clientes headless con 80 ms de latencia y 2 % de pérdida simuladas, 1 carrera, y el estado del servidor coincide con el replay.

**Terminado cuando:**
- 2 navegadores contra `bun run server` en la misma PC y 2 PCs en LAN completan una copa.
- Corrección de reconciliación visible < 5 u en el p95 con 50 ms de latencia simulada.
- Ancho de banda ≤ 20 KB/s por cliente con 8 karts.
- Smoke test en verde.

> Prompt: "Ejecuta la Fase 6 de docs/PLAN.md."

## Fase 7 — Electron, .exe y CI
**Objetivo:** `.exe` portable para jugar en LAN sin instalar nada.
**Skills:** `performance-optimization` (medir en build de release, no en dev).
- [ ] `apps/desktop` (Electron):
  - **Crear partida** levanta el servidor embebido (`ws`);
  - **Unirse** por IP o por descubrimiento UDP (puerto 7778).
- [ ] Guardado en `userData` con escritura atómica (`.tmp` + `.bak`).
- [ ] electron-builder → `.exe` portable. Regla de firewall documentada en la primera ejecución.
- [ ] GitHub Actions en `windows-latest`: tests + validador de pistas + bench + `.exe` como artefacto en cada push/tag.

**Terminado cuando:**
- El `.exe` de CI se abre en una PC limpia y 2 PCs se encuentran por descubrimiento y completan una carrera.
- La build de release cumple los presupuestos.

> Prompt: "Ejecuta la Fase 7 de docs/PLAN.md."

## Fase 8 — Producción de contenido por lotes
**Objetivo:** el resto de mecánicas, objetos, pistas y arte, **una copa por lote**. Cada lote termina jugable en LAN.

Las pistas legacy siguen jugables en la copa "Clásicas" hasta que su versión nueva pase el validador.

**Skills:** `level-design`, `procedural-gen`, `create-game-assets`, `shader-programming`, `game-ai`, `ai-behavior-trees-utility-ai`, `game-feel`, `audio-design`, `performance-optimization`.

| Lote | Pistas (GDD §6.4) | Mecánicas (backlog) |
|---|---|---|
| 8a — Copa Hoja | Pradera JP, Playa Coco (ya hecha), Club de Tenis JP, Bosque Encantado | #18 monedas, #22–#26 reworks + Turbo Bala + Turbo Triple |
| 8b — Copa Estrella | Valle Molino, Dunas Doradas, Bahía Atardecer, Glaciar Polar | #16 hielo y arena, #27 Triple Ciego, #28 Bumerán, #30 Imán, #40 clima, #41 día/noche |
| 8c — Copa Rayo | Ciudad Neón, Selva Tropical, Pico Nevado, Estadio Central | #29 Cadena de Rayos, #31 Bloque de Hielo, #32 Cortina de Humo, compuertas |
| 8d — Copa Fuego | Cañón Rojo, Autopista Láser, Volcán Rugiente, Cráter Ardiente | #33 Ráfaga, lava que avanza, meteoritos |

Para cada lote:
- [ ] Brief de bioma (ART §11). Blockout de las 4 pistas → validador → playtest → arte (en ese orden; nunca se viste antes de que se juegue bien).
- [ ] Mecánicas del lote con test de replay y smoke test de red.
- [ ] Pase de balance de objetos con telemetría local (objetos recibidos/usados por posición, golpes recibidos por posición).

**Terminado cada lote cuando:**
- Las 4 pistas pasan el validador con las métricas de su copa.
- Hay una copa completa en LAN con ≥ 3 humanos.
- Rendimiento dentro del presupuesto en la pista más cargada del lote.

> Prompt: "Ejecuta el lote 8x de la Fase 8 de docs/PLAN.md."

## Fase 9 — Modos, progresión y guardado
**Objetivo:** variedad y razones para volver.
**Skills:** `save-systems`, `game-ui-ux`, `input-systems`, `camera-systems` (repetición final), `level-design` (arenas).
- [ ] Contrarreloj con fantasmas (#56), Eliminación (#57), Equipos (#58).
- [ ] Batalla Globos + 4 arenas (#59) y Captura (#60). Son *Could*: se hacen solo si el resto está terminado.
- [ ] Progresión, desbloqueos, 150cc/Espejo, récords y guardado versionado con migraciones (#61).
- [ ] Repetición final con cámara de highlights (#62).

**Terminado cuando:**
- Cada modo tiene test de `endCondition` con replays.
- Un guardado v1 migra a la versión actual en un test.
- Un guardado corrupto recupera el `.bak`.

> Prompt: "Ejecuta la Fase 9 de docs/PLAN.md."

## Fase 10 (opcional) — Pantalla dividida local
**Skills:** `camera-systems`, `input-systems`, `game-ui-ux`, `performance-optimization`.
- [ ] 2–4 viewports WebGL, un mando por jugador, HUD por viewport. También funciona mezclado con LAN (2 locales + remotos).

**Terminado cuando:** 2 jugadores locales a 60 fps y 4 jugadores a ≥ 45 fps en la PC de referencia.

> Prompt: "Ejecuta la Fase 10 de docs/PLAN.md."

## Fase 11 (opcional) — Online
**Skills:** `performance-optimization`.
- [ ] Dockerfile del server y despliegue en Hetzner con Dokploy (Traefik + WSS).
- [ ] Opción "Online" en el menú con código de sala. Límites por sala y validación de inputs en el servidor (no se confía en el cliente).

**Terminado cuando:** carrera completa entre 2 redes distintas con ≤ 120 ms de latencia y reconciliación estable.

> Prompt: "Ejecuta la Fase 11 de docs/PLAN.md."
