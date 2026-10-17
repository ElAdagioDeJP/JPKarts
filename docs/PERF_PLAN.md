# JP Kart — Plan de rendimiento (juego + conexión)

> Alcance cerrado: **optimizar sin cambiar de lenguaje**. La investigación de 25 frentes (2026-10-16) concluye que el juego es **render-bound en PC** (sim p95 0.484 ms frente a un presupuesto de 2.0 ms), que el lenguaje es el factor nº 6 de los problemas y que ningún port a Go/Rust da fps. Este plan recupera el ~35-50 % del frame que sí es recuperable en TS y el margen de red en 4G.
>
> **Corrección clave respecto al borrador anterior:** en el **cliente online** la sim no es barata. Con cada snapshot (20 Hz), `PredictedRace` hace `restoreWorld` (doble clon JSON del mundo entero) y vuelve a simular todos los ticks `pending` (`prediction.ts:60-70`). Con un RTT de 4G de ~100 ms son unos 6-8 pasos extra por snapshot, es decir, **~3× el coste de sim + GC** en el móvil. El bench headless de PC no lo ve.

Línea base medida: sim p95 0.484 ms (bench PC) · bundle JS 1670 KB (gzip 420 KB) · draw calls 49-60 · snapshots JSON a 20 Hz (`SNAPSHOT_EVERY = 3`) con delta `diffJson` y `perMessageDeflate` ya activo (`server/src/main.ts:10`, `online.ts:119`) · 93 tests (7 dorados).

**Falta en la línea base (la cubre P0):** frame time p95/p99 en el móvil de referencia, tiempo de GPU (hoy `renderMs` mide solo la CPU de envío), **bytes reales en el cable** (ya comprimidos), coste de re-simulación por segundo en el cliente online y pausas de GC.

## 0. Reglas (heredadas de `CLAUDE.md` + `docs/MOBILE.md`)

- **Bits idénticos en `core/`:** solo cambios que no alteren el resultado. Los 7 dorados y los replays deben seguir en verde **sin regenerar** `golden.json`. Con eso se descarta cualquier cambio de comportamiento, por pequeño que sea (ver §4).
- **Instrumentación fuera de `core/`:** `performance.now` está prohibido en core (regla 1; lo comprueba el lint). Los tiempos se toman en quien llama (`localRace.ts`, `netRace.ts`, `bench.ts`, `room.ts`). Para medir por subsistema, el bench llama por separado a las fases de `step` (exportadas si hace falta), sin meter el reloj en core.
- **Protocolo:** un formato de snapshot nuevo **es** un cambio de protocolo. Sube `PROTOCOL_VERSION` (hoy 5) y negocia en `hello` con fallback a JSON (N/N-1). `REPLAY_VERSION` y `hashWorld` no cambian: el formato es solo transporte.
- **Sin cambios de infra** (`docs/DEPLOY.md` intacto).
- **Un cambio de optimización por commit.** El rollback es `git revert`, sin flags nuevos. Una fase a la vez; cada fase termina jugable y con commit.
- **Rituales antes de cada commit:** `bun test` + `bun run typecheck` en verde; `node tools/shot.mjs` tras cada cambio visual; `tools/lan-check.mjs --online` tras cada cambio de red.
- **Sin número no se cierra nada:** cada fase anota el antes y el después en §6 con el protocolo de medición de §1.1.

## 1. Presupuestos

| Métrica | Límite | Cómo se mide |
|---|---|---|
| Sim tick p95 (bench PC) | ≤2.0 ms (objetivo ≤0.35 ms) | `bun run bench` |
| Coste de sim en cliente online (step + resim + restore) | ≤4 ms/frame p95 en móvil | P0: `simMs` de `netRace.ts` desglosado |
| Frame time móvil | p95 ≤33 ms, p99 ≤50 ms (sin tirones) | P0: histograma en `game.perf()` |
| Render CPU | ≤8 ms móvil / ≤6 ms PC | `renderMs` del overlay |
| Render GPU | ≤16 ms móvil / ≤8 ms PC | P0: timestamps de GPU (WebGPU) |
| Draw calls en carrera | ≤60 móvil / ≤80 PC | `renderer.info.render.calls` |
| FPS Volcán, 8 karts, gama media | ≥30 estables (también con `?webgl`) | `game.perf()` |
| Pausas de GC en carrera | 0 pausas >8 ms en 60 s | traza de Chrome (Performance) |
| Bytes en el cable por cliente (comprimidos) | ≤25 KB/s duro, objetivo ≤10 KB/s | P0: `bufferedAmount`/tamaño de trama en `room.ts` |
| Corrección de red p95 | <5 u | test de red existente |
| Bundle JS gzip | ≤440 KB (no crecer) y objetivo ≤350 KB inicial | `bun run build` |

### 1.1 Protocolo de medición (igual para todas las fases)

- **Dispositivos de referencia** (rellenar antes de P0, siempre los mismos): PC `______` (GPU `______`) · móvil gama media `______` (Chrome `___`).
- **Escena fija:** Volcán, 8 karts (7 IA), semilla fija, 60 s de carrera, descartando los 10 primeros segundos (calentamiento y JIT).
- **3 corridas y se toma la mediana.** Se anotan p50, p95 y p99, no medias. Un cambio de menos del 5 % se considera ruido salvo que se repita.
- **Red:** `lan-check --online` con la limitación de red "Fast 4G" de Chrome en el cliente móvil, 2 clientes, 60 s.

## 2. Orden y priorización

**P0 decide el orden.** Las fases P1-P4 se ordenan según el top-3 en ms que salga de P0. El orden por defecto, a falta de datos, es este:

| Fase | Cuello que ataca | Ganancia esperada | Riesgo | Coste |
|---|---|---|---|---|
| P0 Instrumentación | — (habilita el resto) | — | bajo | 1 sesión |
| PM HUD móvil | en el móvil no se ve la carrera | pista visible | bajo | 1 sesión |
| P1 Render | PC y móvil, render-bound | −15-25 % de frame | medio (visual) | 3-4 sesiones |
| P2 Cliente online | móvil online: clon + resim + GC | −50 % del coste de sim online, menos tirones | medio (desync) | 1-2 sesiones |
| P3 Sim sin allocs | GC + resim (multiplica P2) | −25 % de tick | bajo si los bits no cambian | 2 sesiones |
| P4 Red (bytes) | 4G | depende de P0: puede que ya esté en presupuesto | alto (codec) | 0-3 sesiones |
| P5 Carga | arranque en 4G | −20 % de JS inicial | bajo | 1-2 sesiones |
| P6 Cierre | — | — | — | 1 sesión + QA |

### P0 — Instrumentación (1 sesión)
**Objetivo:** ver el frame, la red y el GC antes de tocar nada.

1. **Frame:** histograma de frame time (p50/p95/p99) en `game.perf()` y en el overlay F2. Extiende `game.ts` (`simMs/renderMs/drawCalls`), no lo sustituye.
2. **GPU:** activar los timestamps de GPU del `WebGPURenderer` (comprobar la API en la versión de three instalada) y mostrar `gpuMs` en F2. Sin esto, P1 optimiza a ciegas en WebGPU.
3. **Cliente online:** separar en `netRace.ts` el tiempo de `restoreWorld`, el de resim (pasos de resim por segundo) y el de `step` normal.
4. **Sim por subsistema:** en `bench.ts`, cronometrar por separado karts, entidades, IA y `serializeWorld` (reloj fuera de core, ver §0).
5. **Red:** acumular en `room.ts` los bytes por cliente y segundo, **después** de deflate (tamaño de trama en el cable, no `JSON.length`). Volcarlos con `perf()` en el `log.txt` de `tools/shot.mjs`.
6. **GC/allocs:** una traza de Chrome Performance de 60 s en la escena fija. En JS no se pueden contar los `new` por código: se mide el heap (`performance.memory` en Chrome, `process.memoryUsage().heapUsed` en el bench) antes y después de N ticks, en bytes por tick.

**Terminado cuando:** §6 tiene la fila "Base" completa en PC y móvil (todas las métricas de §1) y una lista del top-3 en ms por dispositivo. Esa lista fija el orden de P1-P4.

### PM — HUD móvil: que se vea la carrera (1 sesión)
**Problema (captura del usuario, 2026-10-16):** en el teléfono el minimapa tapaba el centro de la pista, el botón "Sonido" se montaba sobre la posición y la lista de 8 pilotos, la caja de objeto vacía y los botones táctiles opacos tapaban casi la mitad de la pantalla.
**Causa del minimapa central:** el teléfono tenía un build anterior a `fd7cfda` (minimapa abajo en el centro, `ms = 72`). El código actual ya lo sube arriba a la derecha y oculta "Sonido" en carrera: **hay que volver a desplegar** (`docs/DEPLOY.md`) para que llegue al teléfono.
**Ficheros:** `packages/client/src/hud/hud.ts`, `packages/client/src/style.css`.

1. Lista de posiciones en móvil: solo líder + rival de delante + tú + rival de detrás (máx. 4 filas) en lugar de los 8.
2. Minimapa en móvil sin panel de fondo y al 70 % de opacidad: se ve la pista a través.
3. Caja de objeto vacía al 40 % en móvil (opaca solo cuando hay objeto).
4. Botones táctiles translúcidos (fondo 0.45-0.55 en vez de 0.78-0.85); el borde y el texto siguen nítidos (tamaños ≥56 px intactos, MOBILE M1).

**Terminado cuando:** `node tools/ui-audit.mjs --mobile` sin solapes en carrera; en 844×390 la franja central (kart + pista delante) queda libre de HUD salvo el objeto; desplegado y revisado en el teléfono del usuario.

### P1 — Render: menos draw calls, uploads y tirones (3-4 sesiones)
**Ficheros:** `packages/client/src/render/{worldView,world3d,particles,post,trackArt}.ts`.

1. **Pre-calentar shaders en `loading`** (va primero: es el tirón nº 1 de la primera carrera). Compilar todos los materiales de la pista y de los karts antes de la cuenta atrás con la compilación asíncrona del renderer. **Terminado:** 0 frames >50 ms en los primeros 5 s de la primera carrera.
2. **Partículas:** `update()` recorre los 1024 slots, llama a `setColorAt` y marca `needsUpdate` en dos buffers cada frame aunque solo haya 50 vivas. Hay que recorrer solo las vivas (índice compacto), marcar `needsUpdate` solo si hubo cambios y subir solo el rango usado (`updateRange`/`count`).
3. **Post por tier:** viñeta siempre OFF en móvil (lo pide MOBILE M3); bloom a media resolución en móvil y OFF por debajo de 40 fps, enganchado a `noteFps`.
4. **Etiquetas:** `project()` + texto solo si `depth<ZMAX` y cada 2 frames.
5. **Culling:** hoy el terreno (262k vértices) y el decorado tienen `frustumCulled=false` (`world3d.ts:383,504,519,534`). Partir el terreno en chunks **sube** las draw calls (los 4-8 chunks cuentan contra el presupuesto de ≤60), así que solo se hace si `gpuMs` muestra que el coste está en los vértices. Antes se prueba lo barato: activar el frustum culling en las mallas de decorado que no sean instancias globales.
6. **Instancing:** ya existe en decorado y partículas (`world3d.ts:489-547`). Solo se lleva a karts/things si P0 muestra que esas draw calls son el top.

**Terminado cuando:** Volcán con 8 karts tiene draw calls ≤50 en móvil (tier ahorro); `renderMs` + `gpuMs` bajan ≥15 % frente a la base; no hay regresión visual (`shots/` y `shots-mobile/` revisadas lado a lado); PC WebGPU sigue a 60 fps.

### P2 — Cliente online: restore y resim baratos (1-2 sesiones)
**Ficheros:** `packages/core/src/net/{protocol,prediction}.ts`, `client/src/net/netRace.ts`.

1. **Un solo clon:** `restoreWorld` hace `JSON.parse(JSON.stringify(s))` del mundo entero 20 veces por segundo (`protocol.ts:73-77`), además de `patchJson`. Hay que mantener `base` inmutable y copiarlo sobre `world` con un copiador que reutilice los arrays y objetos existentes (sin clon intermedio). Un test garantiza que `hashWorld` tras restore + resim es idéntico al de antes.
2. **Saltar la resim si la predicción acertó:** guardar `hashWorld` del estado predicho en cada `seq`. Si el estado del servidor en `ack` da el mismo hash, se descartan los `pending` confirmados sin restore ni resim. Solo se implementa si P0 muestra que la resim pesa: guardar un hash por tick cuesta poco, pero cuesta.
3. **`serializeWorld` en el servidor:** usa el mismo doble clon JSON (`protocol.ts:67-70`). Aplicar la misma técnica allí.

**Terminado cuando:** el coste de sim online en móvil (step + restore + resim) baja ≥40 % frente a la base; `net.test.ts` y `lan-check --online` en verde; 0 desync en una copa de 2 carreras.

### P3 — Sim: cero allocs y queries cacheadas, bits idénticos (2 sesiones)
**Ficheros:** `packages/core/src/sim/{world,entities,effects}.ts`, `client/src/race/localRace.ts`. Cada mejora aquí se multiplica en el cliente online por la resim de P2.

1. **Cero allocs por tick** (empezar por el que más pese según los bytes/tick de P0):
   - `quantizeInput` (`world.ts`): quitar el spread y escribir en un struct scratch prealocado.
   - `g.prev = w.karts.map(...)` (`localRace.ts`, `world.ts`): pool de poses reutilizado.
   - `eachFx(k, (fd) => …)` (`sim/effects.ts`): `for` clásico, sin crear una closure por kart y hook.
   - `updateEntities()` (`entities.ts`): **ojo**, el swap-remove cambia el orden de iteración y con él los bits. Hay que usar una compactación in-place que conserve el orden (dos índices), no swap-remove.
2. **Cachear queries de pista:** `locate()`, `edgeDistance()` y `hAt` se calculan varias veces por kart y tick. Se cachean por kart y tick **e invalidan cada vez que cambia la posición del kart** dentro del tick; si no, el resultado cambia y se rompen los dorados.
3. **Broadphase (hash grid de 64 u)** solo si P0 muestra que `zoneAt/slipstream/bumps/boxes` es el top. Los candidatos se devuelven **ordenados por id**, para que el orden de acumulación de floats no cambie. Por debajo de ~20 entidades el O(K×E) actual puede ser más barato que reconstruir el grid: hay que medirlo.

**Terminado cuando:** bench p95 ≤0.35 ms (−25 %), allocs/tick −80 % frente a la base y `golden.json` intacto (sin `--write`); `bun test` en verde.

### P4 — Red: bytes en el cable (0-3 sesiones, según P0)
**Ficheros:** `packages/core/src/net/protocol.ts`, `packages/server/src/room.ts`.

**Antes de escribir un codec:** ya hay delta (`diffJson` contra `lastState`, con snapshot entero para quien reconecta) y deflate. Si P0 mide ≤10 KB/s comprimido por cliente en 4G, **P4 se cierra sin código** y se anota en §6.

Si P0 da más de 10 KB/s, se aplica en este orden, parando en cuanto se cumpla:
1. **Revisar qué viaja:** el snapshot es el `World` entero menos `track`. Ver qué campos cambian en cada tick (los más pesados) y si alguno es caché derivada que el cliente puede recomputar de forma determinista. Solo se puede quitar un campo si los dorados y `net.test.ts` siguen dando el mismo hash tras restore.
2. **Ajustar deflate** (nivel, context takeover, que ayuda mucho a los deltas parecidos entre sí) y medir la CPU del servidor por cliente.
3. **Codec binario** como último recurso: un esquema que codifique **todo** el `WorldState` sin pérdida, con **Float64** (el cliente re-simula desde ese estado; con Float32 o un layout reducido de 8 campos por kart la predicción diverge y aparecen correcciones constantes). Se versiona con `PROTOCOL_VERSION` + `hello{protoVer}` y fallback a JSON. Lleva un test A/B: JSON y binario dan el mismo `hashWorld` tras `patch`.

**Terminado cuando:** ≤10 KB/s medido en `lan-check --online` con 4G simulado, corrección p95 <5 u, sin desync en una copa de 2 carreras y, si hubo codec, fallback JSON verificado forzando un `protoVer` bajo.

### P5 — Carga y arranque (1-2 sesiones)
**Ficheros:** `packages/client/vite.config.ts`, `index.html`, `public/sw.js`, `src/main.ts`.

1. **Medir la composición primero:** `vite build` con sourcemap + `bunx source-map-explorer` (sin dependencia nueva). Es probable que three (build WebGPU) sea la mayor parte; separar el editor no basta si three ocupa ~1 MB. El objetivo se fija con ese dato.
2. **Code-splitting:** editor/debug (`dbg`, F3/F4) y pantallas pesadas en chunks lazy (`import()`).
3. **SW:** precache solo del shell crítico y runtime-cache de los assets de pista bajo demanda. `sw.js` nunca cachea `/health`, `/socket` ni el WS (regla MOBILE M0).
4. **Métrica:** tiempo hasta el menú interactivo con "Fast 4G" + CPU 4× en Chrome (Lighthouse no es representativo en un juego WebGPU).

**Terminado cuando:** JS inicial −20 % (gzip ≤350 KB), tiempo hasta el menú en 4G −20 %, `bun run build` + Docker sirven igual y la PWA sigue instalable (manifest e iconos en `dist`).

### P6 — Validación cruzada y cierre (1 sesión + QA humana)
- `bun test` + `bun run typecheck` + `bun run bench` en verde; `golden.json` sin regenerar.
- `node tools/shot.mjs` (PC) y `--mobile` (844×390) con el protocolo de §1.1; resultados archivados en `shots/` y `shots-mobile/`.
- QA humana: 1 PC con fibra + 1 móvil en 4G real, copa de 2 carreras en Volcán, reconexión de 10 s a mitad, sin desync y corrección p95 <5 u.
- Tabla de §6 completa con números medidos.

**Terminado cuando:** todos los presupuestos de §1 en verde y QA humana firmada en el PR.

## 3. Archivos que se tocan (y los que no)

```
~ packages/client/src/game.ts, dev/debugOverlay.ts (histograma, gpuMs)
~ packages/client/src/render/{worldView,world3d,particles,post}.ts
~ packages/client/src/net/netRace.ts (desglose de sim online)
~ packages/core/src/net/prediction.ts (restore sin clon, salto de resim)
~ packages/core/src/net/protocol.ts (restore/serialize sin doble clon; codec solo si P4 lo exige)
~ packages/core/src/sim/{world,entities,effects}.ts (scratch, caché, compactación)
~ packages/core/bench/bench.ts (tiempos por subsistema, heap/tick)
~ packages/client/src/race/localRace.ts (pool de poses)
~ packages/server/src/room.ts (bytes/s por cliente; emisión binaria solo si P4)
~ packages/client/vite.config.ts, public/sw.js (P5)
~ tools/shot.mjs (perf + red en log.txt)
NO TOCAR: resultado de la sim (bits idénticos), REPLAY_VERSION, docs/DEPLOY.md,
  gameplay/tunables (sin rebalanceos camuflados), assets de pistas.
```

## 4. Lo que NO se hace

**Porque cambia los bits** (requeriría regenerar dorados, que es una decisión de diseño y no de rendimiento):
- **Stagger de IA / cachear `aimPoint` entre ticks:** cambia las decisiones de la IA.
- **Saltar la IA fuera de cámara:** además de cambiar los bits, **el servidor no tiene cámara**. Cliente y servidor divergirían y habría desync.
- **swap-remove en entidades:** cambia el orden de iteración (P3 usa compactación con orden).

**Por coste/beneficio** (decidido por la investigación):
- **Port a Go/Rust/WASM:** 0-1 fps a cambio de semanas y regresiones. Solo se reevalúa si sim p95 >5 ms, >24 karts/sala, >500 CCU o >100 salas concurrentes.
- **Workers/SAB/WASM-threads:** fricción de despliegue (COOP/COEP) y de determinismo para un workload que cabe en un core.
- **Audio en WASM:** ya corre en el C++ del navegador (<2 % CPU).
- **Sidecar Go/Rust en Electron:** firma, antivirus y firewall duplicados para un servidor LAN de KB.
- **SoA con `Float64Array` / rewrite del render:** último recurso, solo si P1-P3 no cierran los presupuestos.

## 5. Riesgos

| Riesgo | Señal | Mitigación |
|---|---|---|
| Una optimización de sim cambia bits sin que se note | dorado rojo o hash de replay distinto | un cambio por commit; `bun test` antes de cada commit; revert |
| El copiador de restore deja referencias compartidas | desync intermitente online | test: restore + resim igual a hash de referencia; `lan-check` con 2 carreras |
| Los chunks de terreno suben las draw calls | `calls` >60 en móvil | solo si `gpuMs` lo justifica; tamaño de chunk en tunables de render |
| Pre-calentar alarga la pantalla de carga | carga >+1 s | compilar en paralelo con la carga de assets; medir |
| Ganancias dentro del ruido | Δ <5 % | protocolo §1.1 (mediana de 3, p95) |

## 6. Resultados (medido, no estimado)

| Fase | Disp. | Frame p95/p99 | renderMs | gpuMs | Sim online | Bench p95 | Allocs/tick | KB/s cable | Draw calls | JS gzip |
|---|---|---|---|---|---|---|---|---|---|---|
| Base | PC | | | | — | 0.414 ms | heap +40.9 MB/5 pistas | 21.8 (deflate con contexto) | 49-60 | 440 KB |
| Base | Móvil | | | | | — | | | | — |
| P4 | PC (test) | | | | | | | **2.0** | | |

### 6.1 Ejecución 2026-10-17 (lo hecho y lo medido)

- **P0:** `bun packages/core/bench/net.ts [pistas] [resim]` mide los bytes por snapshot (JSON, deflate y deflate con contexto) y el coste servidor/cliente. `game.perf()` y F2 añaden frame p95/p99, `resim` (ticks re-simulados) y `resync`. **Pendiente:** timestamps de GPU y dispositivos de referencia (requieren el móvil real).
- **Hallazgo P4:** la red **no** estaba en presupuesto. Base: 52-69 KB/s JSON, 23-26 KB/s deflate y 21.8 KB/s con contexto; el snapshot completo pesa 7-11 KB (no 1.2 KB). Los floats JSON comprimidos ya están cerca de su entropía, así que el codec binario sin pérdida de §P4.3 apenas ganaría.
- **P4 hecho (protocolo 6):** relevo de inputs. El servidor envía los inputs de los humanos de cada tick + `hashWorld` cada 10 snapshots; el cliente avanza su copia autoritativa (`PredictedRace.auth`) con ellos y, si el hash no cuadra o falta un tick, pide `resync` y recibe el estado completo. También se manda el estado completo al empezar, al reconectar y cuando el servidor toca el mundo fuera de `step` (un kart pasa a IA o vuelve). **Resultado:** 2.0 KB/s por cliente (−91 %), 0 resyncs y corrección p95 sin cambios (`server/test/net.test.ts`, que ahora lo exige: <10 KB/s y 0 resyncs). De paso: el servidor ya no serializa ni hace diff del mundo en cada snapshot, y `Room.send` deja de hacer `JSON.stringify` dos veces (`Conn.sendRaw`).
- **P1 parcial:** se precalientan los shaders tras `setTrack` (`compileAsync` en el primer render); las partículas solo suben el rango vivo y nada si no hay ninguna; el bloom a intensidad 0 (ahorro) sale del grafo en lugar de calcular su cadena de mips para nada. **Pendiente:** chunks de terreno y culling de decorado (dependen de `gpuMs` en el móvil).
- **Carga (nuevo, no estaba en el plan):** `bakeAuthored` tardaba 5.7-9.9 s en Ciudad Cargo y Playa Pandas (590 mil celdas × 9×9 cubos × hasta 173 puntos de rama). Con poda por cota inferior + bucles indexados baja a 0.45-0.95 s (**~10×**), con `hm/dg/wg/ng/liq` idénticos bit a bit en las 21 pistas authored (comparado contra `HEAD`).
- **P3 (sim):** el bench da p95 de 0.08-0.11 ms por pista (Playa Pandas 0.54 ms); con P4 el cliente re-simula lo mismo que antes pero sin el diff/patch JSON. No se toca: ganancia pequeña frente al riesgo de cambiar bits. Se reabre solo si `resim` en el móvil sale caro.
- **P5 (carga JS):** three.js (WebGPU + bloom) ocupa 1.11 MB / 307 KB gzip de 1.72 MB / 440 KB gzip. Separar el editor no llega al −20 %: se aplaza, y el presupuesto gzip queda en ≤440 KB.

## 7. Checklist de salida (pegar en el PR)

- [ ] P0: dispositivos de referencia fijados; fila "Base" completa; top-3 por dispositivo; orden de P1-P4 confirmado (hecho: bench de red, frame p95/p99, resim/resync; falta: GPU y móvil de referencia)
- [x] PM: HUD móvil compacto y translúcido (falta: desplegar y revisar en el teléfono)
- [ ] P1: 0 frames >50 ms en el arranque de carrera, draw calls ≤50 en móvil, render −15 %, capturas revisadas
- [ ] P2: sim online −40 % en móvil, 0 desync en una copa de 2 carreras
- [ ] P3: bench p95 ≤0.35 ms, allocs −80 %, dorados intactos
- [x] P4: 2.0 KB/s por cliente con relevo de inputs (protocolo 6), 0 resyncs; corrección p95 sin cambios
- [ ] P5: JS inicial −20 %, menú en 4G −20 %, PWA y Docker intactos
- [ ] P6: copa PC + móvil con reconexión de 10 s, CI en verde, §6 completa
- [ ] Sin cambios de bits en la sim, `REPLAY_VERSION` intacto, `DEPLOY.md` intacto
