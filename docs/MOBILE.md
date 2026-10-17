# JP Kart Móvil — Plan PWA Landscape + Cross-play PC desde día 1

> Alcance cerrado: **solo web móvil + PWA**. Nada de tiendas, nada de Capacitor. **Landscape-only**. **Multijugador móvil ↔ PC desde la primera fase jugable** con el mismo servidor online y salas por código.
> Revisado contra el repo el 2026-10-16, ya con el pull de `54d1a75` + `5f62152` (M0-M5 implementadas). Ver **§0b** (estado real), **M6** (PWA que no abría + menús/tutorial táctiles) y **M7** (power-ups de computación).

## 0. Punto de partida (verificado en repo)

- `packages/client` es Vite + Three.js `WebGPURenderer` con respaldo WebGL2 (`main.ts:18` fuerza con `?webgl`). El `Dockerfile` ya sirve `packages/client/dist` en `/` (`WEB_DIR=/app/web`) junto al server online. El móvil ya puede abrir la URL del PC, pero es injugable.
- `packages/client/index.html:5` ya tiene `viewport-fit=cover`. `style.css` (`#stage`, ~l.24-33) fija 16:9 centrado con `min(98vw, (100dvh-60px)*16/9)`; en móvil hay que pasarlo a pantalla completa con `safe-area-inset`.
- `src/input/input.ts` (clase `Input`, l.29+): teclado + `gamepad.ts`. Contrato: `held(a)` (l.63), `steer()` (l.67), `throttle()` (l.72), `drainPressed()` (l.77), `is(code, action)` (l.83). `race/localRace.ts:74-82` (`localInput`) arma el `SimInput` con `I.held('derrapar')`, `I.throttle()`, `I.steer()` y `g.itemPressed`. Si el táctil alimenta la misma clase, `core` no se toca (reglas 1 y 2 de `CLAUDE.md`).
- **El objeto no sale de `input`**: `app/inputRouter.ts:109/113` pone `g.itemPressed = true` cuando `I.is(code,'objeto')` en `onPress`. El botón OBJETO táctil debe encolar el código de la tecla `objeto` en `pressedQ` (así `onPress` funciona igual que con teclado y respeta el remap).
- `src/game.ts` `frame()` (~l.236) llama `input.poll()` + `drainPressed()`. El sub-paso de simulación está en `race/localRace.ts:89-91` (`acc = min(acc+dt, SIM_DT*5)`), **no** en `game.ts`.
- `src/settings.ts`: `SETTINGS_VERSION = 1`, `MIGRATIONS` solo tiene la clave `0`. Ya existen `hudScale` (1 / 1.5, alterna en `screens/options.ts`), `post`, `shake`, `reduceFlash`. Móvil añade 2-3 campos con migración `1 → 2`.
- `src/render/world3d.ts:228-242`: `init(canvas, forceWebGL)`, `setPixelRatio(1)`, `RW×RH = 960×540`, sombra del sol `mapSize 2048`. `render/particles.ts:5`: `const MAX = 1024`.
- `src/audio/audio.ts` se inicia en `input.onFirstGesture` (`game.ts:143`). En iOS el primer toque debe disparar lo mismo.
- Red: `packages/server/src/online.ts` + `docs/DEPLOY.md` ya dan salas de 5 letras, `pid` con reconexión de 120 s, `start/loaded/go` y `/health`. **`PROTOCOL_VERSION = 4`** (`core/src/net/protocol.ts:8`). El móvil es solo otro cliente `ws`: sin protocolo nuevo.
- `packages/client/public/` ya existe tras el pull (manifest, `sw.js`, iconos). Vite lo copia al `dist` solo; `vite.config.ts` no se toca.
- Pistas reales usadas como referencia: `Valle Python` (`pradera`) y `Volcán Promise` (`volcan`) existen en `core/src/data/tracks.ts`.

## 0b. Estado real tras el pull (validado contra el código)

| Fase | Estado | Matiz verificado |
|---|---|---|
| M0 PWA shell | Hecha, **con 2 bugs** | `sw.js` era cache-first de `./` e `index.html` con cache fija `v1`: tras un deploy el móvil arrancaba un `index.html` viejo que pedía `assets/index-<hash viejo>.js`; el servidor respondía **`index.html` (200, text/html)** a ese JS inexistente y el SW lo guardaba → pantalla en blanco / "no abre". Además `.webmanifest` salía como `application/octet-stream`. |
| M1 táctil | Hecha solo **en carrera** | `TouchControls` solo se ve con `body.racing`. `Input.is('TouchItem')` cuenta como `aceptar`, pero fuera de carrera no hay ningún botón que lo emita. |
| M2 HUD/menús | **Incompleta** | No hay navegación táctil en menús: `main.ts` solo manda `pointerdown` a `game.pointer` (editor de pista). `TAP_MIN_PX` es una constante sin uso. En el móvil el título, el tutorial y el menú **no se podían avanzar**. |
| M3 rendimiento | Hecha | Tiers, `particles`, `localRace.ts:94` (`acc` máx. 4). |
| M4 sonido | Hecha | Botón mute, `reduceFlash` ON en móvil. |
| M5 QA | Parcial | `tools/shot.mjs --mobile`, capturas en `shots-mobile/`. Falta la QA humana en 2 redes. |

## 1. Skills (cargar al empezar cada fase)

Instaladas hoy: `frontend-design`, `prototype`, `tdd`, `diagnosing-bugs`. El resto (`input-systems`, `game-feel`, `game-ui-ux`, `performance-optimization`, `save-systems`, `camera-systems`, `audio-design`) pertenecen al plugin `gamedev`, que **no está en esta sesión**: si falta, se usan sus conceptos, no sus APIs (`CLAUDE.md`, regla 14).

| Skill | Para qué en móvil |
|---|---|
| `frontend-design` | Layout táctil 844×390, botones ≥48 px, `safe-area`, Press Start 2P legible, overlay "gira el teléfono". |
| `prototype` | Controles en 1 sesión: ¿joystick flotante vs fijo? ¿auto-acelerar por defecto? Decisión con números. |
| `input-systems` | Mapear táctil a `Action` (`arriba/abajo/izquierda/derecha/derrapar/objeto`) sin romper teclado, mando ni remap. |
| `game-feel` | Vibración 15-20 ms, pop de botón, deadzone + curva de steering, hit-stop intacto. |
| `game-ui-ux` | Online en 3 taps, QR para pasar el código PC→móvil, pausa con `visibilitychange`. |
| `performance-optimization` | Presupuesto móvil (§3). Medir antes de optimizar: `game.perf()` (`game.ts:165`) + overlay de `dev/debugOverlay.ts`. |
| `save-systems` | `settings` v1→v2; el perfil local (`meta/`) intacto para la reconexión cross-play. |
| `diagnosing-bugs` | Bugs solo-móvil: multi-touch perdido, `pointercancel`, `gesturestart` de iOS, teclado que tapa el código. |
| `tdd` | Cada control nuevo trae test. Sin test no se cierra la fase. |

## 2. Metodología CREA (cómo se ejecuta cada fase)

**C — Contexto y Constraints.** Leer `CLAUDE.md` + esta fase. Anotar qué NO se toca (`core/`, protocolo). Una fase a la vez, termina jugable + commit.

**R — Reproducible primero.** Antes de vestir: prototipo funcional + test (replay, smoke net, `tools/shot.mjs` con viewport móvil). Pregunta: ¿esto se juega con pulgares en un bache a 4G?

**E — Ejecución en vertical slice.** Orden fijo: 1) input/lógica → 2) UI/HUD → 3) rendimiento → 4) arte/feedback. Nunca vestir antes de que se juegue bien.

**A — Aseguramiento con números.** Cada fase tiene "Terminado cuando" medible: fps, ms, px, corrección en `u`. Si supera presupuesto se perfila y se repite. Playtest humano anotado (mínimo 1 PC + 1 móvil en redes distintas en fases con red).

Rituales: `bun test` + `bun run typecheck` en verde antes de commit. `tools/shot.mjs` con viewport móvil tras cada cambio visual. `tools/lan-check.mjs --online=host:puerto` tras cada cambio de input/net.

## 3. Presupuestos móvil (obligatorios)

Dispositivo de referencia: Android gama media 2021 (Snapdragon 720, 4 GB, Chrome) + iPhone 11 (Safari). Pista más cargada: Volcán Promise.

| Métrica | Límite | Cómo se mide |
|---|---|---|
| FPS carrera 8 karts | ≥30 estables, p95 frame ≤33 ms | `game.perf()` + overlay de debug, con y sin `?webgl` |
| Sim tick | ≤2.0 ms (no se toca `core`) | `bun run bench` sigue verde |
| Render CPU móvil | ≤8 ms | `renderMs` del overlay |
| Draw calls | ≤60 | `renderer.drawCalls` (`world3d.ts:871`) |
| PixelRatio | cap 1.5 (ahorro) / 2.0 (alta) | `renderer.setPixelRatio` por tier |
| Peso inicial | JS ≤800 KB gzip; shell PWA <2 MB | salida de `vite build` (medir el real antes de fijar límite: Three.js solo ya pesa mucho) |
| Latencia percibida del toque | ≤100 ms | video a 60 fps + `performance.now` en `touch.ts` |
| Red móvil 4G (80-120 ms, 2 % loss) | corrección p95 <5u, ancho de banda ≤25 KB/s | `core/test` de red + `lan-check --online` |
| Táctil | 5 toques simultáneos sin ghosting, botones ≥48 px | prueba manual + Playwright touch |

Tiers de calidad (auto + manual en Opciones). **El backend se elige al iniciar** (`init`), no se cambia en caliente:
- **Alta:** WebGPU (si existe), sombras 1024, post ON, partículas 1024.
- **Ahorro (defecto en móvil):** `forceWebGL` en móvil salvo que se pruebe que WebGPU rinde mejor, sombras OFF, post OFF, partículas 256, `pixelRatio = min(dpr, 1.5)`. El auto-downgrade solo baja de tier (fps <40 durante 3 s), nunca cambia de backend.

## 4. Fases

### M0 — Shell landscape + PWA instalable (base, 1 sesión)
**Skills:** `frontend-design`, `game-ui-ux`, `save-systems`.
**Objetivo:** el juego abre a pantalla completa apaisada e instalable, sin controles aún.

- `index.html`: `viewport` con `user-scalable=no, viewport-fit=cover`, `mobile-web-app-capable`, `apple-mobile-web-app-capable` + `apple-mobile-web-app-status-bar-style=black-translucent`, `theme-color #1b1740`, `<link rel="manifest">`, `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">`.
- `style.css`: modo `.mobile`: `#stage{width:100dvw;height:100dvh;aspect-ratio:auto;border:0;box-shadow:none}` + `padding:env(safe-area-inset-*)`, `.help{display:none}`, overlay `#rotate-tip` en portrait ("Gira tu teléfono") con `matchMedia("(orientation:portrait)")`. El canvas mantiene 16:9 dentro del stage (letterbox), no se estira.
- `main.ts`: `try{await screen.orientation.lock("landscape")}catch{}` tras el primer gesto + fullscreen. **iOS Safari no soporta `orientation.lock`**: ahí el `#rotate-tip` es la solución real, no un respaldo. `visibilitychange:hidden` → auto-pausa (respeta `paused`). Reajustar el stage con `visualViewport.resize` (el tamaño interno del render sigue siendo `RW×RH`).
- PWA: `public/manifest.webmanifest` (`name` "JP Kart", `short_name`, `display:"standalone"` con `display_override:["fullscreen"]`, `orientation:"landscape"`, `background_color`/`theme_color #1b1740`, iconos 192/512 + 512 `purpose:"maskable"`), `public/sw.js` (cache-first solo del shell: `/`, `index.html`, assets con hash; **no interceptar** `/health`, ni peticiones no-GET, ni WebSocket). Registrar solo si `https` (o `localhost`) **y** no es Electron (`jpkartDesktop`).
- `settings.ts`: `SETTINGS_VERSION = 2`, `MIGRATIONS[1]` añade `touch:{autoGas:true, layout:"default"}` y `quality:"auto"`. Mantiene la copia `.bak`.
- Iconos: ver §5 (tema computación).

**Terminado cuando:** en Android Chrome aparece "Instalar app" (DevTools → Application → Manifest sin errores); en iOS "Añadir a inicio" abre sin barras; en portrait solo se ve el tip; `bun run build` se sirve igual en Docker sin tocar `DEPLOY.md`. (Lighthouse eliminó la categoría PWA en v12: no usarla como criterio.)

### M1 — Controles táctiles + cross-play PC desde día 1 ⭐
**Skills:** `prototype`, `input-systems`, `game-feel`, `tdd`.
**Objetivo:** correr y usar objetos con pulgares contra un PC en la misma sala.

- Nuevo `src/input/touch.ts`: `TouchControls` con `attach(stage)`, `detach()`, `state{steer:-1..1, gas:0..1, brake:0..1, drift, item}`. Joystick izquierdo flotante (aparece donde cae el pulgar, radio 56 px, deadzone 0.15 + curva x^1.4). Derecha: `GAS` (con `autoGas` ON → gas=1 sin pulsar), `FRENO`, `DERAPE`, `OBJETO` (≥56 px, `touch-action:none`, un `pointerId` por dedo, maneja `pointercancel`).
- `input.ts`: añadir `touch` sin romper la API. `held(a)` → `|| touch.held.has(a)`; `steer()` → táctil si `|v|>0.05`; `throttle()` → táctil. El botón OBJETO encola en `pressedQ` el primer código de `bindings.objeto` para que `drainPressed()` → `onPress` → `itemPressed` funcione sin cambios. Nada de `core`.
- Feedback: `navigator.vibrate?.(15)` en objeto y derrape nivel 3 (**iOS Safari no vibra**; es un extra, no una dependencia), botón con `:active` scale 0.92, la barra de drift reutiliza el HUD actual.
- Menús: `screens/netScreens.ts` — campo de código con `autocomplete="off"`, botón "Pegar código" (clipboard), QR del código en el lobby. El teclado de iOS no debe tapar el input (`visualViewport`).
- Test: `packages/client/test/touch.test.ts` (ya hay `models.test.ts` y `music.test.ts`) — secuencia táctil sintética (gas+izq 60 ticks, derrape, objeto) produce el mismo `SimInput` que la secuencia de teclado equivalente; el hash lo cubre el test de replay existente del core.

**Terminado cuando:** prototipo A/B (joystick fijo vs flotante) probado por 2 personas, gana flotante o se documenta por qué no; carrera de 3 vueltas en Valle Python con 1 PC (teclado) + 1 móvil (táctil) en la misma sala online sin desync (corrección p95 <5u); vuelta móvil dentro de 130 % del tiempo del PC; 5 toques simultáneos no pierden `pointerId`.

### M2 — HUD y menús dedo-grande
**Skills:** `game-ui-ux`, `frontend-design`.
**Objetivo:** leer y navegar a 30 cm con el pulgar.

- `hud/hud.ts`: en móvil `hudScale` efectivo 1.5 (reusa el ajuste existente), minimapa 20 % más grande abajo-centro (fuera de los pulgares), texto de posición 24 px, aviso `incoming` con icono + vibración, zona segura.
- `screens/menus.ts` + `netScreens.ts`: filas ≥48 px; Online en 3 taps (servidor ya viene pre-rellenado por `VITE_ONLINE_SERVER`/`sameOriginServer()` en `game.ts:41/87`); lobby con el código en 32 px + botón copiar.
- `ui/draw.ts`: hitboxes táctiles separadas de las visuales (el dedo tapa ~40 px, el tap-target mide 56).
- Sin cámara nueva (sigue al kart local, regla 7); se conserva el FOV kick.

**Terminado cuando:** guerrilla con 2 usuarios: crear sala + unirse + arrancar carrera <60 s sin ayuda; sin mis-taps en 3 carreras; capturas `shots-mobile/` revisadas.

### M3 — Rendimiento y batería (tier auto)
**Skills:** `performance-optimization`, `diagnosing-bugs`.
**Objetivo:** 30 fps en gama media sin tocar `core`.

- `render/world3d.ts`: `init(canvas, forceWebGL, tier)` — `setPixelRatio(min(dpr, tier.cap))`, sombra 1024→512/OFF, `antialias:false` en tier bajo. Auto-downgrade: fps <40 durante 3 s → baja un tier + aviso "Modo ahorro".
- `render/post.ts`: bloom OFF en ahorro; viñeta OFF en táctil pequeño.
- `render/particles.ts`: `MAX` pasa de constante a valor por tier (1024 → 512 → 256). Revisar que ningún código asuma 1024.
- `race/localRace.ts:89`: en móvil `acc` máx. 4 sub-pasos (no 5) para evitar la espiral en jank. La pantalla dividida se deshabilita en móvil (1 jugador por teléfono).
- Batería: `navigator.getBattery?.()` (solo Chromium) → si <20 % sugiere ahorro. `document.hidden` pausa el render, no la sim online (el server te pasa a IA 120 s, como ya hace).

**Terminado cuando:** Volcán Promise con 8 karts: gama media ≥30 fps p95, render CPU ≤8 ms, draw calls ≤60 en tier ahorro; sin regresión en PC (WebGPU a 60 fps); `bun run bench` sin cambios.

### M4 — Sonido móvil + game-feel táctil final
**Skills:** `game-feel`, `audio-design`.
**Objetivo:** se siente como kart, no como página web.

- Audio iOS: `Audio.init()` cuelga de `onFirstGesture`; añadir `touchend → init + resume()` explícito (iOS exige gesto de usuario, `touchstart` no cuenta) + botón mute visible (no hay tecla M).
- Motores posicionales ya existen: bajar volumen ~20 % en altavoz móvil, ducking intacto.
- Haptics (solo Android con `navigator.vibrate` y `shake>0`): golpe leve 10 ms, medio 20 ms, objeto recibido 30 ms. `reduceFlash` ON por defecto en móvil.

**Terminado cuando:** prueba ciega: 2 usuarios distinguen turbo/derrape/golpe solo por sonido+haptics; sin audio cortado en Safari tras 3 carreras.

### M5 — Deploy, QA cruzada y release
**Skills:** `diagnosing-bugs`, `tdd`.
**Objetivo:** la URL actual ya es la versión móvil. Sin `DEPLOY.md` nuevo.

- Build: `bun run build` genera la PWA; el `Dockerfile` ya copia `dist` completo (incluye manifest, `sw.js` e iconos de `public/`). Verificar `Content-Type` de `manifest.webmanifest` y que `sw.js` se sirva desde `/` (scope).
- Herramientas: `tools/shot.mjs --mobile` (hoy fija viewport 1280×800: añadir flag, 844×390, `isMobile`, `hasTouch`), `tools/lan-check.mjs --online=wss://… --mobile` (1 PC headless + 1 emulado táctil), `tools/nextrace-check.mjs` desde red móvil.
- QA humana obligatoria: 1 PC en fibra + 1 móvil en 4G, misma sala por código, copa de 2 carreras, reconexión a mitad (wifi apagado 10 s → vuelve con el mismo `pid`).
- Rollback: si M1-M3 rompen PC, revert por fase (cada fase es un commit jugable).

**Terminado cuando:** copa completa PC+móvil en redes distintas sin desync; PWA instalable en Android + iOS; `bun test` + `bun run typecheck` verdes y el job de Docker/CI del repo (si existe) verde.

### M6 — Hotfix: la PWA instalada abre, menús y tutorial en el teléfono (prioridad 0)
**Skills:** `diagnosing-bugs`, `frontend-design`, `tdd`.
**Objetivo:** instalar la PWA, abrirla y pasar título → tutorial → nombre → menú → carrera, todo con el dedo.

Causas raíz (verificadas en el código; **falta confirmarlo en un teléfono real**):
1. **Service worker rancio.** Cache `v1` fija + cache-first del shell + servidor que devuelve `index.html` para cualquier ruta inexistente.
2. **Sin navegación táctil fuera de carrera** (ver §0b): en el título solo responde `Enter`.
3. **El nombre no se puede escribir** en el primer arranque: el teclado virtual solo se abría en `online`/`lan`, no en `welcome`.
4. **Tutorial hablando de teclas** ("Acelerar: ↑ / W", "Esc: saltar") y sin pausa táctil.

Hecho en esta revisión:
- `public/sw.js` v2: red primero para shell y manifest (un deploy nuevo se ve al abrir; sin red, la última copia), cache-first **solo** para `/assets/*` y **solo** si la respuesta no es HTML; `activate` borra caches viejas.
- `server/src/online.ts`: un archivo con extensión que no existe responde **404** (ya no `index.html`); `.webmanifest` con `application/manifest+json`.
- `manifest.webmanifest`: `id`, `display:"standalone"` + `display_override:["fullscreen","standalone"]` (iOS ignora `fullscreen`).
- `input/touch.ts` `attachMenuPad` + `Input.pressCode`: botones ◀ ▲ ▼ ▶ / ATRÁS / OK (≥56 px) que encolan los mismos códigos que el teclado, visibles con `body.menu-nav` (todo menos carrera, y la pausa). Botón **II** de pausa en carrera local y **SALIR** (doble toque) en carrera online. Tocar el título o una página del tutorial = OK.
- `welcome.ts`: tutorial con texto táctil (joystick, GAS, FRENO, DERAPE, OBJETO, II) y pista "Toca el recuadro para escribir"; el teclado virtual ahora también se abre en `welcome`.

**Terminado cuando:** (a) con una build nueva desplegada, la PWA ya instalada abre la versión nueva sin reinstalar; (b) primer arranque en un teléfono: título → 5 páginas → nombre con teclado → menú → carrera sin teclado ni mando; (c) pausa y salir al menú con el dedo; (d) `bun test` verde.
**Límites conocidos:** no se toca directamente la fila de un menú (se navega con flechas + OK); en carrera online el botón SALIR pide un segundo toque en 2 s; no se probó en un teléfono real.

### M7 — Power-ups de computación (backlog #64-#67)
**Skills:** `tdd`, `game-feel`.
**Objetivo:** más variedad sin tocar el bucle de carrera (regla 4: un archivo + su registro).

| # | Objeto (id) | Rol | Qué hace | Zonas [líder, medio, cola] |
|---|---|---|---|---|
| 64 | **Overclock** (`overclock`) | movilidad | +18 % de velocidad punta 5 s (efecto `oc`, sin inmunidad) | 26 · 24 · 8 |
| 65 | **Fork Bomb** (`forkbomb`) | trampa | 3 minas de proximidad en fila detrás de ti | 12 · 24 · 16 |
| 66 | **Antivirus** (`antivirus`) | defensa | Quita tus debuffs (`control`/`slow`) y te hace inmune a nuevos 4 s (efecto `av`) | 0 · 10 · 22 |
| 67 | **Pico de Latencia** (`lagspike`) | ataque, remontada | Todos los de delante van −18 % 4 s (efecto `lag`); no hace nada si vas primero (y el líder no puede sacarlo: tier alto) | 0 · 8 · 24 |

Detalles verificados:
- Se insertan en el registro (el orden define el *tier*), por eso `distribution.highTier` pasa de 16 a 19 y `firstMaxTier` de 11 a 13: los objetos existentes conservan su tier relativo.
- Iconos 16×16 en `art/sprites.ts`, sonidos en `feel/eventFeedback.ts`, etiquetas HUD en `feel/effectView.ts`, `aiScore` en cada objeto.
- `PROTOCOL_VERSION` 4 → 5 (un cliente viejo no conoce los ids nuevos; el handshake de tunables ya lo habría rechazado).
- Se regeneró `core/test/golden.json` (las tiradas de objetos cambian) y `itemzones.test.ts` cuenta `lagspike` entre los fuertes. Test nuevo: `core/test/items-computing.test.ts`.

Ideas siguientes (no hechas): **Ctrl+Z** (volver a la posición de hace 2 s; necesita historial serializable en el estado), **Ping** (marca al líder para la IA), **Sudo** (ignora un hazard), **Caché** (guarda un objeto para la siguiente caja). Cada una = fila nueva en el backlog.

### M8 — Conexión floja o poca batería: el cliente no se queda pegado (prioridad 0)
**Skills:** `diagnosing-bugs`, `tdd`.
**Síntoma:** con poca batería o poco internet, los demás avanzan y el jugador se queda "pegado": se mueve y controla, pero no ve nada.

Causas encontradas en el código (verificadas leyendo; **no se pudo reproducir en un teléfono**):
1. **Pausa automática en carreras online.** `main.ts` pausaba la carrera al ocultar la pestaña (`visibilitychange`), también online. Con la carrera pausada `frame()` no llama a `simulate`, la cámara se actualiza con `dt = 0` (se congela) y el router ignora `P`/pausa en red, así que **nada la quitaba**. Modo ahorro de batería, avisos del sistema o cambiar de app lo disparan.
2. **Ráfaga de snapshots tras un parón.** Cada snapshot hacía `restoreWorld` + re-simular los inputs pendientes. Tras una pestaña congelada llegaban decenas de golpe y se repetía el trabajo por cada uno.
3. **Línea "muerta" falsa.** `simulateNet` abandonaba el socket tras 4 s sin snapshots, también cuando el navegador había estrangulado la pestaña (el contador seguía corriendo y el mensaje llegaba después).

Hecho:
- Online nunca se pausa: `visibilitychange` solo pausa carreras locales, `frame()` y `simulateNet` fuerzan `paused = false` en red.
- `PredictedRace` separa `ingest` (barato, aplica el delta al estado base) de `reconcile` (restaurar + re-simular, una sola vez). `NetSession.flushSnaps()` lo llama una vez por frame, antes de simular; `onSnapshot` sigue existiendo (ingest + reconcile).
- Umbral de línea muerta 4 s → 8 s, no se aplica con la pestaña oculta, y al volver a primer plano el contador se reinicia.
- Test nuevo en `server/test/net.test.ts`: un cliente congelado 4 s acumula snapshots, reconcilia una vez y termina a <40 u del servidor.

**Sin resolver / a vigilar:** (a) si la pérdida de gráficos (contexto WebGL/WebGPU perdido) deja el canvas en negro con los controles vivos, no hay manejador: habría que escuchar `webglcontextlost` y reiniciar el renderer; (b) en un móvil lento `frame()` limita `dt` a 1/30 y el acumulador a 5 pasos, así que por debajo de ~12 fps la predicción local va más lenta que el servidor (se corrige con cada snapshot, pero se nota); (c) hace falta una prueba con `tools/stall-check.mjs` en un dispositivo real con red limitada.

### M9 — Estilo desarrolladora (NexTec.plus)
**Skills:** `frontend-design`.
**Objetivo:** que el juego se vea hecho para un equipo de software, sin tocar ids (guardados, replays y red usan los ids estables).

Hecho:
- **Cajas de objeto**: ya no son esferas tipo pelota; ciclan teclado → ratón → portátil con código → taza de Java (`art/devArt.ts`). La **Caja Falsa** es una pantalla azul (BSOD) con cara de enojo. El cursor del menú y la pantalla de carga usan los mismos cuatro sprites.
- **Escenario** (mismas claves en `D`, así que las pistas no cambian): vaca → ratón, granero → centro de datos, sombrilla → monitor con código, tabla de surf → teclado vertical, camello → portátil, faro → torre de antena, boya → memoria USB, boya rayada → CD.
- **Copas y pistas por lenguaje** (ids intactos): Copa **Python** (Valle Python, Playa Pandas, Bosque Django, Campus Kernel), Copa **C++** (Valle Puntero, Dunas STL, Bahía Segfault, Glaciar CMake; es la antigua Estrella y mantiene el cielo estrellado), Copa **Rust** (Ciudad Cargo, Estadio Borrow, Pico Crate, Selva Tokio) y Copa **JavaScript** (Autopista Node, Cañón Callback, Cráter Undefined, Volcán Promise). Las clásicas igual. Colores por lenguaje: verde, azul, naranja, amarillo.
- **Copa Estrella más estrellada**: las 4 pistas (Valle Rust, Dunas del Dato, Bahía Bluetooth, Glaciar Git) activan `stars` y el cielo dibuja ahora una Vía Láctea punteada, ~2200 estrellas de 5 colores y ~110 destellos en cruz, con su propio RNG (el resto del escenario no se mueve).
- Título: línea "</> Edición NexTec.plus".

Pendiente (decisión): los cascos esféricos de los pilotos se parecen a una pelota (casco azul del jugador); no se tocaron porque son el diseño de cada piloto. Si se quieren cambiar, la opción barata es un casco-monitor o auriculares grandes en `art/codeModels.ts` (`buildCodeHead`). Tampoco se cambiaron las bolas de nieve y las rocas de los obstáculos (`bolanieve`, `roca`).

## 5. Temática computación (iconos, sprites, logos)

Estado verificado: el juego ya está retematizado de tenis a computación (pista `tenis` → "Campus Kernel", hazards `bug`; lo vigila `core/test/retheme.test.ts`). Quedaban restos **fuera** de lo que escanea ese test, ya corregidos:

- `apps/desktop/scripts/icon.ts` y `tools/gen-mobile-icons.mjs`: ya no dibujan la pelota de tenis / disco lima; dibujan un **chip de CPU** pixel-art (cuerpo azul noche, núcleo turquesa, pines dorados). El chip ocupa 12/16 de la cuadrícula; el maskable lo reduce al 80 %.
- `packages/client/index.html`: favicon SVG del mismo chip (antes un círculo lima de pelota).
- `art/sprites.ts`: `BALL` (esfera de la Caja Falsa) pasó del lima de pelota de tenis a turquesa `#5de6c8`. Los ids estables `tenis`/`tenis-jp` se quedan (guardados).
- Regenerar iconos PWA: `bun tools/gen-mobile-icons.mjs` (`icon-192`, `icon-512`, `maskable-512`); icono de escritorio: `bun apps/desktop/scripts/icon.ts`. El `apple-touch-icon` usa `icon-192.png`.
- Textos de la PWA en español, tono computación: "Gira tu teléfono", nombre "JP Kart".

## 6. Archivos que se tocan (y los que no)

```
+ packages/client/public/manifest.webmanifest
+ packages/client/public/icons/*.png        (ya generados por tools/gen-mobile-icons.mjs)
+ packages/client/public/sw.js
+ packages/client/src/input/touch.ts
+ packages/client/test/touch.test.ts
~ apps/desktop/scripts/icon.ts              (hecho: chip de CPU + iconos PWA)
~ packages/client/index.html                (favicon hecho; falta viewport/meta PWA/manifest)
~ packages/client/src/style.css             (.mobile, #rotate-tip)
~ packages/client/src/main.ts               (orientation lock, viewport, touch attach, registro sw)
~ packages/client/src/input/input.ts        (mezclar estado táctil)
~ packages/client/src/settings.ts           (v2: touch, quality)
~ packages/client/src/render/world3d.ts     (tiers)
~ packages/client/src/render/post.ts        (bloom off en ahorro)
~ packages/client/src/render/particles.ts   (MAX por tier)
~ packages/client/src/race/localRace.ts     (acc máx. 4 en móvil)
~ packages/client/src/hud/hud.ts            (escala móvil)
~ packages/client/src/screens/netScreens.ts (código grande + QR + pegar)
~ tools/shot.mjs, tools/lan-check.mjs       (--mobile)
NO TOCAR: packages/core/**, packages/server/src/online.ts (protocolo v4), docs/DEPLOY.md, vite.config.ts
```

## 7. Riesgos y mitigaciones

- iOS Safari sin WebGPU estable → backend decidido al iniciar por tier/capacidad, no por UA; medir, no adivinar.
- `screen.orientation.lock` falla sin fullscreen y no existe en iOS → overlay portrait; el juego no arranca en portrait.
- Teclado iOS tapa el código → `visualViewport` + input arriba del fold + botón pegar.
- Multi-touch en Chrome Android pierde `pointerId` en `pointercancel` → test dedicado; el joystick flotante re-ancla al dedo restante.
- Service worker sirviendo un shell viejo tras un deploy → versionar el cache con el hash del build y borrar caches antiguos en `activate`.
- Batería/calor → tier ahorro por defecto en móvil, nunca alta por defecto.

## 8. Qué se corrigió en esta revisión

- `PROTOCOL_VERSION` es 4, no 2.
- El plan decía que el objeto entra por una "tecla Space virtual" en `drainPressed`; en realidad lo decide `inputRouter.onPress` con `is(code,'objeto')`.
- El límite de sub-pasos está en `race/localRace.ts:89`, no en `game.ts`.
- `packages/client/public/` no existe; Vite lo copia solo, así que `vite.config.ts` no se toca.
- `settings.ts`: la migración nueva es la clave `1` (la `0` ya existe).
- Lighthouse ya no tiene categoría PWA; criterio cambiado por el panel Manifest.
- Cambio de backend WebGPU→WebGL2 en caliente no es posible; ahora se decide en `init`.
- `orientation.lock`, `vibrate` y `getBattery` no existen en iOS Safari; marcados como extras.
- `display:fullscreen` no lo respeta iOS; manifest con `standalone` + `display_override`.
- `particles.ts` usa una constante `MAX`, no un "assert existente".
- Falta `apple-touch-icon` (iOS no usa los iconos del manifest); añadido.
- "Peg code" → "Pegar código"; "mamalonas" y el desglose de skills ajustados a lo realmente instalado.
- Referencias de línea aproximadas actualizadas; `F2` del overlay no se pudo confirmar, se cita `dev/debugOverlay.ts`.

## 9. Checklist de salida (pegar en PR)

- [ ] M0 PWA instalable Android+iOS, landscape-only con tip en portrait
- [ ] M1 táctil jugable + PC+móvil misma sala, p95 <5u, vuelta móvil <130 % PC
- [ ] M2 Online en 3 taps, HUD legible a 30 cm
- [ ] M3 ≥30 fps Volcán 8 karts gama media, draw calls ≤60
- [ ] M4 audio iOS sin cortes, haptics (Android), mute visible
- [ ] M5 copa PC (fibra) + móvil (4G) + reconexión 10 s, tests verdes
- [ ] M6 PWA instalada abre tras un deploy; título → tutorial → nombre → carrera solo con el dedo
- [ ] M7 4 objetos nuevos con test, icono, sonido e IA
- [ ] M8 online: ni pausa atascada ni ráfaga de snapshots; probar con red limitada y batería baja
- [ ] M9 estilo NexTec.plus: cajas, escenario, nombres y Copa Estrella
- [ ] Iconos/favicon/sprites con temática computación
- [ ] Sin cambios en `core`, protocolo: solo el bump 4 → 5 de M7, `DEPLOY.md` intacto
