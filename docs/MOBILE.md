# JP Kart Móvil — Plan PWA Landscape + Cross-play PC desde día 1

> Alcance cerrado: **solo web móvil + PWA**. Nada de tiendas, nada de Capacitor. **Landscape-only**. **Multijugador móvil ↔ PC desde la primera fase jugable** con el mismo servidor online y salas por código.

## 0. Punto de partida (verificado en repo)

- `packages/client` es Vite + Three.js `WebGPURenderer` con fallback WebGL2 automático (`main.ts:18` fuerza con `?webgl`). `Dockerfile` ya sirve `packages/client/dist` en `/` junto al server online. El móvil ya puede abrir la misma URL del PC — solo que es injugable.
- `packages/client/index.html:5` ya tiene `viewport-fit=cover`. `style.css:23-31` fija `#stage` a 16:9 centrado para desktop — en móvil hay que romperlo a fullscreen landscape con `safe-area-inset`.
- `src/input/input.ts:29-104` es solo teclado + `gamepad.ts`. `steer()` / `throttle()` / `held()` son el único contrato que usa `race/localRace.ts:74-83` (`localInput`). Si el táctil alimenta esa misma clase, `core` no se toca (regla 1 y 2 de `CLAUDE.md`).
- `src/game.ts:238` corre a 60Hz con acumulador, `input.poll()` + `drainPressed()`. El táctil debe vivir ahí, no en DOM aparte.
- `src/settings.ts:7-23` ya tiene `hudScale`, `post`, `shake`, `reduceFlash` — el modo móvil solo añade 2-3 flags versionados, con migración.
- `src/render/world3d.ts:228-237` fija `setPixelRatio(1)`, sombras 2048 y `RW=960xRH=540`. En móvil eso mata la batería: hay que tierizarlo.
- `src/audio/audio.ts` se desbloquea en `input.onFirstGesture` (`game.ts:143`). En iOS el primer tap táctil debe disparar lo mismo.
- Red: `packages/server/src/online.ts` + `docs/DEPLOY.md` ya dan salas de 5 letras, `pid` con reconexión 120s, `start/loaded/go`. El móvil es solo otro cliente `ws` — no hay protocolo nuevo.

## 1. Skills mamalonas (cargar al empezar cada fase)

No son adorno: cada fase indica cuáles usar. Si falta el plugin `gamedev`, usar sus conceptos, no sus APIs (como dice `CLAUDE.md:15`).

| Skill | Para qué en móvil |
|---|---|
| `frontend-design` | Layout táctil 844×390, botones ≥48px, `safe-area`, tipografía Press Start 2P legible, overlay "gira el teléfono". |
| `prototype` | Prototipo de controles en 1 sesión: ¿joystick flotante vs fijo? ¿auto-acelerar ON por defecto? Decisión con números, no gusto. |
| `input-systems` | Mapear táctil a `Action` (`acelerar/frenar/izquierda/derecha/derrapar/objeto`) sin romper teclado/mando/remap. |
| `game-feel` | El táctil se siente mal sin feedback: vibración 15-20ms, pop de botón, deadzone + curva de steering, hit-stop intacto. |
| `game-ui-ux` | Menús con dedo: Online (nombre+server+código) en 3 taps, QR para pasar código PC→móvil, pausa con `visibilitychange`. |
| `performance-optimization` | Presupuesto móvil (ver §3). Medir antes de optimizar: `perf()` de `game.ts:165` + overlay F2. |
| `save-systems` | `settings` v1→v2 (flags táctiles), perfil `jpkart.profile` intacto para reconexión cross-play. |
| `diagnosing-bugs` | Caza de bugs solo-móvil: multi-touch perdido, `pointercancel`, iOS Safari `gesturestart`, teclado que tapa el código. |
| `tdd` | Cada control nuevo trae test de replay/hash. Si no hay test, no se cierra la fase. |

## 2. Metodología CREA (cómo se ejecuta cada fase)

**C — Contexto y Constraints.** Leer `CLAUDE.md` + esta fase. Anotar qué NO se toca (`core/`, protocolo). Una fase a la vez, termina jugable + commit.

**R — Reproducible primero.** Antes de vestir: prototipo funcional + test que lo prueba (replay dorado, smoke net, `tools/shot.mjs` con viewport móvil). Pregunta prototipo: ¿esto se juega con pulgares en un bache a 4G?

**E — Ejecución en vertical slice.** Orden fijo por fase: 1) input/lógica → 2) UI/HUD → 3) rendimiento → 4) arte/feedback. Nunca vestir antes de que se juegue bien (regla Fase 8 del `PLAN.md`).

**A — Aseguramiento con números.** Cada fase tiene "Terminado cuando" medible: fps, ms, px, % top-4, corrección neta en `u`. Si supera presupuesto, se perfila y se repite. Playtest humano anotado (mínimo 1 PC + 1 móvil en redes distintas para fases con red).

Rituales: `bun test` + `bun run typecheck` en verde antes de commit. `tools/shot.mjs` con viewport móvil tras cada cambio visual. `tools/lan-check.mjs --online` tras cada cambio de input/net.

## 3. Presupuestos móvil (obligatorios)

Dispositivo referencia: Android gama media 2021 (Snapdragon 720, 4GB, Chrome) + iPhone 11 (Safari). Pista más cargada: Volcán Rugiente.

| Métrica | Límite | Cómo se mide |
|---|---|---|
| FPS carrera 8 karts | ≥30 estables, p95 frame ≤33ms | `game.perf()` + overlay F2, `?webgl` también |
| Sim tick | ≤2.0ms (no se toca `core`) | `bun run bench` sigue verde |
| Render CPU móvil | ≤8ms | `renderMs` del overlay |
| Draw calls | ≤60 | `renderer.drawCalls` |
| PixelRatio | cap 1.5 (ahorro) / 2.0 (alta) | `renderer.setPixelRatio` por tier |
| Peso inicial | JS ≤800KB gzip, PWA instalable <2MB | `vite build --report` |
| Touch→fotón latencia percibida | ≤100ms | video 60fps + `performance.now` en `touch.ts` |
| Net móvil 4G (80-120ms, 2% loss) | corrección p95 <5u, bw ≤25KB/s | `net.test.ts` + `lan-check --online` |
| Táctil | 5 toques simultáneos sin ghosting, botones ≥48px | test manual + Playwright touch |

Tiers de calidad (auto + manual en Opciones):
- **Alta:** WebGPU, sombras 1024, post ON, partículas 1024.
- **Ahorro (defecto en móvil):** WebGL2 si WebGPU <40fps 3s seguidos, sombras OFF, post OFF, partículas 256, `pixelRatio` min(dpr,1.5).

## 4. Fases

### M0 — Shell landscape + PWA instalable (base, 1 sesión)
**Skills:** `frontend-design`, `game-ui-ux`, `save-systems`.
**Objetivo:** el juego actual abre a pantalla completa apaisada e instalable, sin controles aún.

- `index.html`: `user-scalable=no, viewport-fit=cover`, `mobile-web-app-capable`, `apple-mobile-web-app-capable + status-bar-style=black-translucent`, `theme-color #1b1740`, `orientation=landscape` en manifest.
- `style.css`: modo `.mobile`: `#stage{width:100dvw;height:100dvh;aspect-ratio:auto;border:0}` + `padding:env(safe-area-inset-*)`, `.help{display:none}`, `#rotate-tip` overlay portrait ("Gira tu teléfono 📱↻") con `matchMedia("(orientation:portrait)")`.
- `main.ts`: `try{await screen.orientation.lock("landscape")}catch{}` tras primer gesto + fullscreen; `visualViewport.resize` → `renderer.setSize`; `visibilitychange:hidden` → auto-pausa (respeta `paused`).
- PWA: `public/manifest.webmanifest` (name JP Kart, short_name, display:fullscreen, orientation:landscape, icons 192/512 maskable), `public/sw.js` (cache-first solo shell `/`, `index.html`, assets; **network-only** para `/health`, `/socket`, `ws/wss`), registro solo si `matchMedia mobile + https`. `vite.config.ts`: copiar manifest/icons al `dist` (ya servido por `Dockerfile` en `/app/web`).
- `settings.ts`: migración v1→v2 añade `touch:{autoGas:true, layout:"default"}`, `quality:"auto"`. Respeta `.bak`.

**Terminado cuando:** en Android Chrome "Instalar app" aparece; en iOS "Añadir a inicio" abre fullscreen; en portrait solo se ve el tip; Lighthouse PWA ≥90; `bun run build` sirve igual en Docker sin tocar `DEPLOY.md`.

### M1 — Controles táctiles + cross-play PC desde día 1 ⭐
**Skills:** `prototype`, `input-systems`, `game-feel`, `tdd`.
**Objetivo:** correr y usar objetos con pulgares contra un PC en la misma sala.

- Nuevo `src/input/touch.ts` (~250 líneas): `TouchControls` con `attach(stage)`, `detach()`, `state{steer:-1..1, gas:0..1, brake:0..1, drift, item}`. Joystick izquierdo flotante (aparece donde cae el pulgar, radio 56px, deadzone 0.15 + curva x^1.4), derecha: `GAS` (grande, con `autoGas` por defecto ON → gas=1 sin pulsar), `FRENO`, `DERAPE`, `OBJETO` (≥56px, `touch-action:none`, `pointerId` por dedo, maneja `pointercancel`).
- `input.ts`: añadir `touch{steer,throttle,held:Set<Action>}` sin romper API. `held(a)` → `|| touch.held.has(a)`. `steer()` → touch si `|v|>0.05`. `throttle()` → touch. `drainPressed()` incluye `item` táctil como `Space` virtual para que `localInput()` (`localRace.ts:74-83`) y `onPress` funcionen sin cambios. Nada de `core`.
- Feedback (`game-feel`): `navigator.vibrate?.(15)` en item/derrape nivel 3, botón con `:active` scale 0.92, barra drift reutiliza HUD actual.
- Menús: `screens/netScreens.ts` — campo código con `inputmode="text" autocomplete="off"`, botón "Peg code" (clipboard), QR del código en lobby para escanear desde el otro dispositivo. Teclado iOS no tapa el input (`visualViewport` scroll).
- Test: `client/test/touch.test.ts` — secuencia táctil sintética (gas+izq 60 ticks, drift, item) produce `SimInput` idéntico en Bun y Chrome → mismo hash. Smoke net existente con input táctil grabado.

**Terminado cuando:** prototipo A/B (joystick fijo vs flotante) probado por 2 personas, gana flotante o se documenta por qué no; carrera 3 vueltas Pradera JP: 1 PC (teclado) + 1 móvil (táctil) en misma sala online completan sin desync (corrección p95 <5u); vuelta móvil dentro de 130% del tiempo PC; 5 toques simultáneos no pierden `pointerId`.

### M2 — HUD y menús dedo-grande
**Skills:** `game-ui-ux`, `frontend-design`, `camera-systems`.
**Objetivo:** leer y navegar a 30cm con pulgar.

- `hud/hud.ts`: escala móvil `hudScale` efectivo 1.5, minimapa 20% más grande abajo-centro (fuera de pulgares), texto posición 24px, `incoming` con icono + vibración, zona segura `safe-area`.
- `screens/menus.ts` + `netScreens.ts`: filas ≥48px, Online en 3 taps (Servidor pre-rellenado por `VITE_ONLINE_SERVER`/`sameOriginServer`, Crear/Unirse grandes), lobby muestra código en 32px + botón copiar.
- `ui/draw.ts`: hitboxes táctiles separadas de las visuales (el dedo tapa 40px, el tap-target es 56px).
- Sin cámara nueva (la cámara sigue al kart local, regla 7). Solo FOV kick ya existente se conserva.

**Terminado cuando:** test de guerrilla con 2 usuarios: crear sala + unirse + arrancar carrera <60s sin ayuda; sin mis-taps en 3 carreras; capturas `shots-mobile/` revisadas.

### M3 — Rendimiento y batería (tier auto)
**Skills:** `performance-optimization`, `diagnosing-bugs`.
**Objetivo:** 30fps en gama media sin tocar `core`.

- `render/world3d.ts`: `init(canvas, forceWebGL, tier)` — `setPixelRatio(min(dpr, tier.cap))`, sombras `1024→512/OFF`, `antialias:false` en tier bajo, `toneMapping` simple. Auto-downgrade: si fps<40 durante 3s → baja tier + toast "Modo ahorro".
- `render/post.ts`: `setGrade` intacto, bloom OFF en ahorro, viñeta OFF en split/táctil pequeño.
- `render/particles.ts`: pool 1024→512→256 por tier (assert existente lo permite).
- `game.ts:frame`: en móvil `acc` max 4 sub-pasos (no 5) para no espiral en jank; `renderSplit` no aplica (pantalla dividida deshabilitada en móvil — 1 jugador por teléfono).
- Batería: `navigator.getBattery?.()` → si <20% sugiere ahorro. `document.hidden` pausa render (no sim online — el server te pasa a IA 120s como ya hace).

**Terminado cuando:** Volcán Rugiente 8 karts: gama media ≥30fps p95, render CPU ≤8ms, draw calls ≤60 en tier ahorro; sin regresión en PC (WebGPU 60fps intacto); `bench` sim p95 ≤0.1ms.

### M4 — Sonido móvil + game-feel táctil final
**Skills:** `game-feel`, `audio-design`.
**Objetivo:** se siente como kart, no como página web.

- Audio iOS: `Audio.init()` ya cuelga de `onFirstGesture` — añadir `touchstart→init+resume()` explícito + botón mute visible (M no existe en móvil).
- Motores posicionales ya existen: bajar volumen 20% en altavoz móvil (evita saturación), ducking intacto.
- Haptics: golpe leve 10ms, medio 20ms, objeto recibido 30ms (solo si `navigator.vibrate` + ajuste `shake>0`). `reduceFlash` fuerza ON por defecto en móvil.

**Terminado cuando:** prueba ciega: 2 usuarios distinguen turbo/drift/golpe solo por sonido+haptics; sin audio cortado en Safari tras 3 carreras.

### M5 — Deploy, QA cruzada y release
**Skills:** `diagnosing-bugs`, `tdd`.
**Objetivo:** la URL actual ya es la versión móvil. Sin `DEPLOY.md` nuevo.

- Build: `bun run build` genera PWA; `Dockerfile` la sirve igual (verificar `WEB_DIR` incluye manifest + sw + icons). `VITE_ONLINE_SERVER` ya deja el server escrito.
- Herramientas: `tools/shot.mjs --mobile` (viewport 844×390, `isMobile,touch`), `tools/lan-check.mjs --online=wss://kart.tudominio.com --mobile` (1 headless PC + 1 emulado touch), `tools/nextrace-check.mjs` desde red móvil.
- QA humana obligatoria (condición de "Terminado"): 1 PC fibra + 1 móvil 4G, misma sala por código, copa de 2 carreras, reconexión a mitad (apagar wifi 10s → vuelve con mismo `pid` como espectador y recupera kart).
- Rollback: si M1-M3 rompen PC, revert por fase (cada fase es commit jugable).

**Terminado cuando:** copa completa PC+móvil en redes distintas sin desync; PWA instalable en Android + iOS; Lighthouse Performance móvil ≥70 con tier ahorro; `bun test` + CI `docker-online` verdes.

## 5. Archivos que se tocan (y los que no)

```
+ packages/client/public/manifest.webmanifest
+ packages/client/public/icons/*.png
+ packages/client/public/sw.js
+ packages/client/src/input/touch.ts
+ packages/client/test/touch.test.ts
~ packages/client/index.html (viewport, meta PWA)
~ packages/client/src/style.css (.mobile, #rotate-tip)
~ packages/client/src/main.ts (orientation lock, viewport, touch attach)
~ packages/client/src/input/input.ts (mezclar estado táctil)
~ packages/client/src/settings.ts (v2: touch, quality)
~ packages/client/src/render/world3d.ts (tiers)
~ packages/client/src/render/post.ts (bloom off en ahorro)
~ packages/client/src/hud/hud.ts (escala móvil)
~ packages/client/src/screens/netScreens.ts (código grande + QR + pegar)
~ packages/client/vite.config.ts (copiar PWA al dist)
NO TOCAR: packages/core/**, packages/server/src/online.ts (protocolo), docs/DEPLOY.md
```

## 6. Riesgos y mitigaciones

- iOS Safari sin WebGPU estable → fallback `?webgl` automático por tier, no por UA. Medir, no adivinar.
- `screen.orientation.lock` falla sin fullscreen → overlay portrait bonito, el juego no arranca en portrait.
- Teclado iOS tapa el código → `visualViewport` + input arriba del fold + botón pegar.
- Multi-touch en Chrome Android pierde `pointerId` en `pointercancel` → test dedicado, joystick flotante re-ancla al dedo restante.
- Batería/calor → tier ahorro por defecto en móvil, nunca alta por defecto.

## 7. Checklist de salida (pegar en PR)

- [ ] M0 PWA instalable Android+iOS, landscape-only con tip portrait
- [ ] M1 táctil jugable + PC+móvil misma sala, p95 <5u, vuelta móvil <130% PC
- [ ] M2 Online en 3 taps, HUD legible a 30cm
- [ ] M3 ≥30fps Volcán 8 karts gama media, draw calls ≤60
- [ ] M4 audio iOS sin cortes, haptics, mute visible
- [ ] M5 copa PC( fibra)+móvil(4G) + reconexión 10s, CI verde
- [ ] Sin cambios en `core`, protocolo v2 intacto, `DEPLOY.md` intacto
