# JP Kart v3 — Plan completo (equilibrio estilo Mario Kart, 12 pilotos, piezas, objetos, rampas, modelos 3D)

> Documento único y autosuficiente para el agente que lo ejecuta. Decisiones cerradas con el usuario en una sesión de preguntas (2026-10-17). **No reabrir decisiones**: si algo no encaja con el código, se detiene la fase, se anota en §11 "Bitácora" y se pregunta al usuario.
>
> Ya hecho antes de este plan: rendimiento P0-P4 (commit `f060670`, protocolo 6 por relevo de inputs) y el arreglo del exploit planeo+turbo (commit `c10b52c`: `glideE`, paneles solo en el suelo).

---

## 0. Cómo trabajar (leer primero)

1. Lee `CLAUDE.md` (reglas 1-14 obligatorias), luego este documento entero, luego solo los archivos que cada fase nombra.
2. **Una fase a la vez**, en el orden de §3. Cada fase termina **jugable**, con `bun test` + `bun run typecheck` en verde, y con **un commit** en la rama `v3` (`git switch -c v3` la primera vez). Se hace push de la rama al final de cada fase. No se fusiona a `main` hasta la V3-7 y la QA del usuario.
3. **Skills:** al empezar cada fase carga las de su línea "Skills". Si una skill no está instalada en esta máquina, sigue sin ella y anótalo en la bitácora. Son de dos familias:
   - plugin `gamedev`: `physics-tuning`, `game-feel`, `game-ai`, `ai-behavior-trees-utility-ai`, `game-ui-ux`, `level-design`, `create-game-assets`, `camera-systems`, `save-systems`, `input-systems`, `performance-optimization`, `shader-programming`, `audio-design`;
   - de proceso: `tdd` (test primero en todo lo de core), `diagnosing-bugs` (si algo falla), `code-review` (al cerrar cada fase, contra este plan), `prototype` (solo donde se indica).
4. **Dorados:** `golden.json` solo se regenera (`bun packages/core/test/golden.ts --write`) en las fases que cambian la física **a propósito** (V3-1, V3-2, V3-4, V3-5) y el commit lo dice explícitamente.
5. **Bitácora (§11):** al terminar cada fase añade una línea con la fecha, el commit, los números medidos y lo pendiente. Si se acaba la sesión a mitad, la bitácora es el punto de reanudación.
6. Textos del juego en español; código en inglés (regla 13). Números de balance siempre en `core/data/tunables/*.json` (regla 5).

---

## 1. Decisiones cerradas

| # | Decisión |
|---|---|
| Alcance | 12 pilotos, sistema de stats estilo MK, piezas modulares, selector/constructor estilo MK8, objetos por distancia + 3 nuevos, rampas/trucos/planeo rediseñados con cañones, modelos 3D nuevos de los 12 con animaciones. Desbloqueos con monedas: **fuera** (v3.1). |
| Karts | **12 por carrera**; hasta **12 humanos** por sala LAN/online (máx. 4 por dispositivo). |
| Repetidos | Personaje **único** por sala; piezas **repetibles**. |
| Stats visibles | **Velocidad, Aceleración, Peso, Manejo, Tracción**. Ocultas: **Mini-turbo** (inverso a la velocidad) y **Vuelo** (energía de planeo). |
| Velocidad | **Regla de Mario**: los pesados tienen ~8 % más de velocidad punta que los ligeros; los ligeros, más aceleración, manejo y mini-turbo. La velocidad global sube. |
| Presupuesto | Fijo e igual para todos (25 puntos visibles). JP pierde su ventaja actual. |
| Rubberbanding | Solo la IA; los humanos solo reciben ayuda de objetos y rebufo. |
| Objetos | 6 zonas; zona = máx(zona por puesto, zona por distancia al líder). Del 7.º-8.º hacia atrás nunca salen objetos flojos. Nuevos: **Modo Dios**, **Overclock Infinito**, **Piloto Automático**. |
| Rampas | 3 tipos (salto, truco, planeo); trucos fiables; planeo con energía; **cañones** en 2-3 pistas que obligan a planear y no se pueden rodear. |
| Datos | JSON + validación de esquema en tests. **Nada de base de datos** (offline/LAN, hash en el handshake, determinismo). |
| Selector | Cuadrícula de 12 → constructor de kart con modelo girando y barras en vivo → Aleatorio; se recuerda el último kart por perfil; 30 s de límite en LAN/online. |
| Modelos | Los 12 nuevos (incluidos JP y Miguel), chibi 3D fiel a los retratos pixel, con rig y 7 clips; 11 piezas de kart. Hechos con el MCP oficial de Blender Lab (Blender 5.1+). |
| Red | Protocolo **7** (loadout en el lobby, 12 jugadores). |

---

## 2. Datos de diseño

### 2.1 Fórmula aditiva (core)

```
visible(stat) = clamp(base_personaje[stat] + chasis[stat] + ruedas[stat] + ala[stat], 0, 10)
miniTurbo     = clamp(15 − 2·visible.vel + Σ piezas.mt, 0, 10)          // oculto, inverso a la velocidad
vuelo         = clamp(5 + (5 − visible.pes)·0.5 + Σ piezas.vue, 0, 10)  // oculto, alimenta glideE
```

Mapeo a física (coeficientes en el tunable nuevo `core/data/tunables/stats.json`; los valores iniciales son estos y se calibran en V3-7):

| Stat | Efecto | Fórmula inicial |
|---|---|---|
| vel | velocidad punta | `spd = 1 + (vel − 5)·0.04` (ligero 4 → 0.96, pesado 6 → 1.04, ~8 % de diferencia) y × `speedGlobal` (empieza en 1.08) |
| ace | aceleración y recuperación tras golpe | `acl = 1 + (ace − 5)·0.05` |
| man | giro | `hnd = 1 + (man − 5)·0.04` |
| pes | empuje en choques, clase de peso | `w = pes`; clase: `pes < 4` ligero, `pes ≥ 6` pesado, si no medio |
| tra | agarre en superficies resbaladizas y pérdida fuera de pista | `grip ×= 1 + (tra − 5)·0.06`; penalización offroad × `1 − (tra − 5)·0.06` |
| mt (oculta) | carga y duración del mini-turbo | `driftCharge ×= 1 + (mt − 5)·0.06`; `boostTime ×= 1 + (mt − 5)·0.05` |
| vue (oculta) | energía de planeo | `glideE` se agota a `dt / (0.7 + vue·0.06)` (ya existe como `st.fly`) |

Las stats se calculan **una vez** en `createWorld` y se guardan en el kart como números planos (`k.st`, regla 3); la sim no vuelve a leer `CHARS` por kart y tick.

### 2.2 Los 12 pilotos (presupuesto 25; vel/ace/pes/man/tra)

| Piloto | Corto | Clase | vel | ace | pes | man | tra | Identidad | IA |
|---|---|---|---|---|---|---|---|---|---|
| **Patrón** (solo tests/calibración) | — | medio | 5 | 5 | 5 | 5 | 5 | línea base | — |
| Marco | Marco | ligero | 4 | 6 | 3 | 7 | 5 | rey del manejo | agresivo |
| Andrés | Andrés | ligero | 4 | 7 | 3 | 6 | 5 | el que más acelera | oportunista |
| Eduardo | Edu | ligero | 3.75 | 6 | 3 | 6.75 | 5.5 | limpio, gran tracción | **limpio** (nueva) |
| Henry | Henry | ligero | 4.5 | 6.5 | 3 | 6 | 5 | el ligero más rápido | **caótico** (nueva) |
| Guaycaipuro | Guayca | medio | 5 | 4.5 | 5 | 4.5 | 6 | todoterreno | oportunista |
| Jesús | Jesús | medio | 4.75 | 5.5 | 4.75 | 5.5 | 4.5 | técnico | defensivo |
| Miguel | Miguel | medio | 5 | 6 | 5.5 | 4.5 | 4 | arranque explosivo | agresivo |
| Ángel | Angelito | medio | 5.5 | 4.5 | 5.5 | 4.5 | 5 | agresivo de pelotón | agresivo |
| Luis | Luis | pesado | 6 | 3.5 | 7.5 | 3 | 5 | el muro | equilibrado |
| JP | JP | pesado | 6 | 4 | 7 | 3 | 5 | el pesado que acelera | equilibrado |
| Mario | Mario | pesado | 6 | 3.5 | 6.5 | 4 | 5 | el pesado que gira | defensivo |
| Diego | Dieguito | pesado | 6.5 | 3 | 7.5 | 3 | 5 | el más rápido en recta | defensivo |

Test obligatorio: cada fila suma 25 y cada clase cae en su rango de peso.

**IA nuevas** (`tunables/ai.json → personality`):
- `limpio`: ataca poco (attack 0.6), sigue la línea ideal (lineFocus alto) y usa los objetos defensivos sobre todo para bloquear.
- `caotico`: usa los objetos en cuanto los tiene (holdTime bajo), le gustan los de caos y hace un 20 % más de errores de línea.

### 2.3 Aspecto de los 4 nuevos y colores

Los 8 actuales conservan su aspecto. Colores de casco ocupados: rojo, verde, morado, blanco, casi negro, azul, gris y cian. Los nuevos usan colores muy distintos:

| | Eduardo "Edu" | Diego "Dieguito" | Ángel "Angelito" | Henry |
|---|---|---|---|---|
| Casco / color principal | naranja `#ff7a1a` | amarillo `#ffd23a` | magenta `#ff3d9a` | lima `#b6ff3a` |
| Kart | `#1a8a8a` (petróleo) | `#2a2a3a` (grafito) | `#f4f1ff` (blanco) | `#6a3fd6` (violeta) |
| Piel | morena `#a8704a` | morena clara `#c08858` | blanca `#f4d0b0` | blanca `#f2d4bc` |
| Pelo | lacio negro `#1a1410`, raya al lado | calvo; **gorra negra** con visera | rubio `#e8c860`, corto | castaño claro `#b08850`, corto peinado de lado |
| Cara | **lentes** finos, sin barba | sin barba | **barba rubia** corta, ojos azul claro | **lentes** de montura gruesa, **perilla** |
| Cuerpo (3D) | flaco | alto y gordito | alto | complexión media-delgada |
| `acc` (pixel) | `glasses` | `cap` (nuevo) | `beard` | `glasses` + `goatee` (nuevo) |
| Voz (Hz) | 140 | 95 | 120 | 155 |

En el minimapa y en la lista de posiciones, cada punto lleva un borde del color de acento (el `accCol` del personaje) para distinguir colores parecidos.

### 2.4 Piezas (catálogo de la v3: 4 + 4 + 3; `core/data/parts.json`)

Deltas en vel/ace/pes/man/tra más los ocultos mt/vue. Cada pieza suma ≈ 0 entre las visibles.

| Tipo | id | Nombre | vel | ace | pes | man | tra | mt | vue | Forma (para Blender) |
|---|---|---|---|---|---|---|---|---|---|---|
| chasis | `kernel` | Kernel | 0 | 0 | 0 | 0 | 0 | 0 | 0 | kart clásico equilibrado (el actual) |
| chasis | `overdrive` | Overdrive | +1 | −0.5 | 0 | −0.5 | 0 | −0.5 | 0 | deportivo bajo y alargado, alerón |
| chasis | `mainframe` | Mainframe | +0.5 | −1 | +1 | −0.5 | 0 | 0 | −0.5 | ancho y blindado, tipo servidor en rack |
| chasis | `rover` | Rover | −0.75 | +0.5 | −0.75 | 0 | +1 | +0.5 | 0 | buggy alto, jaula antivuelco |
| ruedas | `std` | Estándar | 0 | 0 | 0 | 0 | 0 | 0 | 0 | rueda kart normal |
| ruedas | `slick` | Slick | +0.5 | 0 | 0 | +0.5 | −1 | 0 | 0 | lisa y ancha |
| ruedas | `offroad` | Todoterreno | −0.5 | −0.5 | 0 | 0 | +1 | 0 | 0 | tacos grandes |
| ruedas | `mini` | Mini | −1 | +1 | −0.5 | +0.5 | 0 | +0.5 | 0 | pequeñas tipo patín |
| ala | `wing` | Estándar | 0 | 0 | 0 | 0 | 0 | 0 | 0 | el `wing.glb` actual rehecho |
| ala | `glider` | Planeadora | −0.25 | 0 | 0 | +0.25 | 0 | 0 | +2 | ala larga de planeador |
| ala | `light` | Ligera | 0 | +0.5 | −0.25 | −0.25 | 0 | 0 | −1 | ala corta tipo cometa |

Nombres de piezas en español en la UI. El esquema se valida en un test (ids únicos, tipos válidos, deltas en [−2, 2], la suma de las visibles en [−0.5, 0.5]).

### 2.5 Objetos (6 zonas, 12 karts)

- `items.json → zones`: pasa de 3 columnas a **6**. `zoneByRank = floor(rank · 6 / nKarts)`; `zoneByDist = ` umbrales de distancia al líder en unidades de pista (tunables `distZones: [0, 300, 700, 1200, 1800, 2600]`, a calibrar); **zona = máx(ambas)**.
- **Objetos flojos** (Bocina, Falsa, Goma, Ciego): peso 0 en las zonas 4-6. Turbo Triple, Overclock y ataques fuertes desde la zona 4.
- Nuevos (cada uno = un archivo `defineItem` + efecto `defineEffect` + `aiScore` + eventos + test de replay, regla 8):
  - **Modo Dios** (equivale a la Estrella), zonas 5-6: 6 s invencible, +15 % de velocidad, golpea al contacto e ignora la penalización fuera de pista. Eventos: `godStart/godEnd`.
  - **Overclock Infinito** (equivale al Champiñón Dorado), zonas 4-6: 6 s; cada pulsación de objeto da un turbo de 0.6 s. Evento: `boost` con `src: 'overclockInf'`.
  - **Piloto Automático** (equivale al Bill Bala), **solo la zona 6**: 5 s conduciendo solo por `track.line` a 1.6× la velocidad base; arrolla y es invulnerable; al terminar, 0.5 s de invulnerabilidad. Usa la misma línea de carrera que la IA (`ai/line`). Eventos: `autoStart/autoEnd`.
- Ninguno de los 3 sale en las zonas 1-3. `bun packages/core/tools/item-odds.ts` imprime la tabla de los 12 puestos, y su salida va a la bitácora.

### 2.6 Rampas, trucos, planeo y cañones

- **Tipos** en `AuthoredTrackDef.ramps[]`: `kind: 'hop' | 'trick' | 'glide'` (las rampas existentes pasan a `trick` si tenían `big`, si no a `hop`). Cada tipo tiene un aspecto distinto en `trackArt`: salto con franja amarilla, truco azul con flechas, planeo con un arco con el ala pintada.
- **Trucos fiables:** ventana `trick.takeoff` de 0.25 → **0.45 s**; cuenta **pulsar o soltar** el derrape (`inp.d !== k.dPrev`); el despegue se dispara al cruzar una rampa marcada (por índice de pista), no solo por cambio de pendiente. El truco elige la animación por la dirección (`trickKind`: izquierda = tirabuzón, derecha = giro, centro = mortal) y viaja en el evento `trick`. Boost: `hop` = mini-turbo; `trick` = turbo largo (`bigBoost`).
- **Planeo:** ya tiene energía (`glideE`, `glideTime` = 4 s × vuelo). Se reduce el planeo general: `glideLiftGain` 0.675 → 0.6, a calibrar en V3-7.
- **Cañones** (`AuthoredTrackDef.chasms[]: { i0, i1, depth, wallH }`), en **3 pistas**: Volcán Promise, Cráter Undefined y una montañosa a elegir con `track-info`.
  - `bakeAuthored` hunde el terreno `depth` bajo el tramo [i0, i1], **quita la carretera** en ese tramo y levanta paredes de altura `wallH` a los lados, de modo que no se puede rodear.
  - La rampa de planeo anterior al cañón **garantiza velocidad**: al cruzarla, `speed = max(speed, glideLaunchSpeed)` y siempre abre el ala (se activa siempre, a cualquier velocidad).
  - Si caes al fondo: rescate y reaparición en la pista antes del cañón (el mismo flujo que el agua), con ~2 s de pérdida.
  - `validate:tracks` añade una comprobación: con la peor configuración (vuelo mínimo = pesado + ala Ligera) y sin input, lanzado a `glideLaunchSpeed`, el kart **aterriza al otro lado**; y ningún camino terrestre une ambos lados (flood-fill sobre el heightfield con altura < pared).

### 2.7 12 karts por carrera

`MAX_PLAYERS` 12; parrilla de 12 (las parrillas de las pistas authored se generan en 2 columnas × 6 filas y se validan); puntos de copa estilo MK8 para 12 (`15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1`, tunable); Eliminación con 12; Batalla/Captura con 12 en las arenas (validar espacio); Equipos 6 contra 6; HUD de pantalla completa con 12 filas que caben (el móvil ya usa 4 filas); resultados y clasificación con 12 filas; `buildGrid`, `cupPts` y todo lo que use `8` a mano: `grep -rn "\b8\b"` en `core/src`, `server/src` y `client/src/hud|screens`, y revisar cada caso.

---

## 3. Fases

### V3-1 — Sistema de stats y rebalanceo (core) · Skills: `physics-tuning`, `tdd`, `game-ai`
1. `tunables/stats.json` (coeficientes de §2.1 + `speedGlobal`) registrado en `T` y en `tunablesHash`.
2. `characters.json`: nuevo esquema de stats (`vel, ace, pes, man, tra`), sin `vue` visible; `characters.ts` calcula `spd/acl/hnd/w/tra/mt/fly` con §2.1 (todavía sin piezas: deltas = 0). `STAT_NAMES` pasa a Velocidad/Aceleración/Peso/Manejo/Tracción; el texto "Fuerte en…" se recalcula.
3. Física: tracción en `grip` y en la penalización offroad; mini-turbo en la carga del derrape y la duración del turbo.
4. Tests: suma 25 por personaje, rangos de clase, un ligero carga el mini-turbo antes que un pesado, un pesado tiene más punta en recta, y las superficies resbaladizas penalizan menos con más tracción.
5. Dorados regenerados (cambio intencionado).

**Terminado cuando:** tests en verde; `bun packages/core/tools/ai-balance.ts` sin un personaje que gane más del 20 % de las carreras de IA (anotar la tabla en la bitácora).

### V3-2 — 4 pilotos nuevos y 12 karts por carrera · Skills: `game-ai`, `ai-behavior-trees-utility-ai`, `game-ui-ux`, `performance-optimization`
1. Edu, Dieguito, Angelito y Henry en `characters.json` (§2.2-2.3); retratos pixel en `art/sprites.ts` con los `acc` nuevos `cap` y `goatee`; modelo provisional por código (`codeModels.ts`) hasta que lleguen los `.glb`.
2. IA `limpio` y `caotico`.
3. Todo lo de §2.7. Protocolo: `MAX_PLAYERS` 12 (el cambio de protocolo completo llega en V3-3).
4. Rendimiento con 12: `bun run bench` p95 ≤ 2 ms; `node tools/shot.mjs` en Volcán con 12 karts: draw calls (PC ≤ 80, móvil ≤ 60, con el tier ahorro si hace falta) y fps anotados.

**Terminado cuando:** una carrera, una copa, Eliminación, Batalla y Equipos funcionan con 12; `tools/modes-check.mjs` y `tools/ui-audit.mjs` (escritorio y `--mobile`) sin solapes; `lan-check` con 2 humanos + 10 IA.

### V3-3 — Piezas, selector y constructor, lobby, protocolo 7 · Skills: `game-ui-ux`, `input-systems`, `save-systems`, `tdd`, `frontend-design` (solo dirección visual)
1. `core/data/parts.json` (§2.4) + validador de esquema en test; `RaceConfig.grid[i].parts = { body, wheels, wing }`; la fórmula aditiva completa.
2. **Selector** (`client/src/screens`): cuadrícula 4×3 de caras (clase y nombre) → **constructor**: 3 carruseles con el modelo del kart girando en una vista 3D pequeña, barras de las 5 stats visibles que cambian en vivo (la base del personaje en un color y el delta de la pieza en verde/rojo), botón Aleatorio y confirmar. Táctil, teclado y mando (regla de MOBILE M1: objetivos ≥ 56 px).
3. Pantalla dividida: cada jugador en su cuadrante.
4. **Perfil**: `lastLoadout` por perfil; `PROFILE_VERSION` +1 con migración (regla 11).
5. **Protocolo 7:** `pick` lleva `{ ch, parts }`; el servidor valida contra `parts.json` (ids existentes) y el personaje único; el lobby muestra el kart de cada uno; 30 s de límite con Aleatorio para quien no confirme (solo LAN/online). Tests en `server/test` (pick inválido rechazado, timeout aplica Aleatorio, 12 jugadores).
6. Modo "Estadísticas iguales": **no** (decidido).

**Terminado cuando:** se puede armar un kart en local, en pantalla dividida y en LAN; `lan-check` con piezas distintas da el mismo `hashWorld` en servidor y clientes (0 resyncs); `ui-audit` del selector y del constructor sin solapes.

### V3-4 — Objetos por distancia y objetos nuevos · Skills: `game-feel`, `game-ai`, `tdd`, `audio-design`
1. 6 zonas + `distZones` + la regla del máximo (§2.5).
2. Modo Dios, Overclock Infinito y Piloto Automático, completos según la regla 8: test de replay, `aiScore`, eventos, feedback en el client (partículas, SFX propio con distancia y pan, música acelerada en Modo Dios, icono en el HUD) y su fila en `MECHANICS_BACKLOG.md`.
3. `item-odds.ts` con 12 puestos, con la tabla en la bitácora.

**Terminado cuando:** el test de odds demuestra que los puestos 8-12 no pueden recibir Bocina/Falsa/Goma/Ciego y que el 12.º tiene ≥ 25 % de probabilidad de uno de los 3 nuevos; `tools/items-shots.mjs` con capturas de los 3.

### V3-5 — Rampas, trucos, planeo y cañones · Skills: `physics-tuning`, `level-design`, `game-feel`, `tdd`
1. `ramps[].kind`, migración de las pistas authored y aspecto por tipo (§2.6).
2. Trucos fiables + `trickKind` + animaciones provisionales (giro del modelo por código) hasta los clips de V3-6.
3. Cañones en las 3 pistas + `glideLaunchSpeed` + rescate + el validador de §2.6.
4. **Pistas técnicas (decisión del usuario, 2026-10-17, tras V3-1):** reescribir el trazado (spline) de ~la mitad de las pistas de carrera (~9 de 18) con curvas cerradas, horquillas y chicanes, de modo que los ligeros (más manejo, aceleración y mini-turbo) compitan con los pesados. Lo midimos con `ai-balance --wins` por arquetipo; `validate:tracks` en verde; se regeneran los dorados. Las 'Clásicas' legacy no se tocan (regla 12).
5. Tests: truco al soltar el derrape; truco en rampa suave; cruzar el cañón con la peor configuración; caer al cañón provoca rescate; rodear el cañón es imposible (validador).

**Terminado cuando:** `bun run validate:tracks` en verde; `tools/hazard-shots.mjs` con capturas de los cañones; en una carrera de prueba la IA cruza los 3 cañones sin caer en más del 10 % de los intentos.

### V3-6 — Modelos 3D (Blender) e integración · Skills: `create-game-assets`, `camera-systems`, `performance-optimization`, `shader-programming`
Se divide en **6a (Blender, §4)** y **6b (integración)**. La 6a es la más larga: se puede hacer piloto a piloto con un commit por piloto.

**6b — integración en el client:**
1. Carga de `driver_<id>.glb` y `part_<id>.glb` con `GLTFLoader`; `AnimationMixer` por kart con los clips de §4.3 enlazados a eventos: `steerL/R` mezclado por el volante, `trick` (por `trickKind`), `hit`, `lookBack` (cámara trasera), `victory` en el podio e `idle`.
2. Montaje: piloto en el empty `seat` del chasis, ruedas en `wheel_FL/FR/RL/RR`, ala en `glider`.
3. **LOD:** a más de 60 u de la cámara se usa `<id>_LOD1`; con 12 karts, las draw calls dentro del presupuesto.
4. **Tamaño de descarga:** los `.glb` ya **no** van inline en el JS (hoy usan `?inline`). Se sirven como archivos, con runtime-cache del SW. En Electron se registra un protocolo `app://` (`protocol.handle`) para que `fetch` funcione bajo `file://`. El presupuesto de JS gzip (≤ 440 KB) tiene que mantenerse.
5. Se borran los modelos viejos (`jp_body/head`, `miguel_body/head`) y los modelos por código de los pilotos, cuando los 12 `.glb` estén integrados.

**Terminado cuando:** las capturas en carrera (de frente con la cámara trasera, de espaldas y en el podio) de los 12 están en `shots/v3-models/` y revisadas por el usuario; el bundle JS gzip ≤ 440 KB; draw calls dentro del presupuesto con 12 karts.

### V3-7 — Balance final y QA · Skills: `physics-tuning`, `game-ai`, `performance-optimization`, `code-review`
1. Calibrar `speedGlobal`, `stats.json`, `distZones` y `glideLiftGain` con `ai-balance` en 3 arquetipos de pista: rectas (gana pesado), técnica (gana ligero) y mixta (empate ±5 %). Ningún personaje con >15 % de victorias en el total.
2. `bun test`, `typecheck`, `bench`, `validate:tracks`, `ui-audit` (escritorio y móvil), `lan-check --online`, `nextrace-check`.
3. QA humana con el usuario: copa de 4 carreras con 12 (humanos + IA), en PC y en móvil.
4. `code-review` de la rama contra este plan → arreglos → merge a `main` y push (con el permiso del usuario).

---

## 4. Modelos 3D con el MCP oficial de Blender Lab (V3-6a)

### 4.1 Herramienta (verificado en blender.org/lab/mcp-server, 2026-10-17)
- **Blender 5.1 o superior** + add-on **Blender MCP 1.0.3** de Blender Lab (Install from Disk) + el servidor MCP (bundle `.mcpb` o desde el código fuente) registrado en Claude Code (`claude mcp add …` según su README).
- **Ejecuta el Python (`bpy`) que mandas, sin salvaguardas.** Reglas de seguridad: nunca borrar ni escribir fuera de `art/blender/` y `packages/client/src/assets/models/`; nada de red desde Blender; guardar el `.blend` antes de cada operación destructiva.
- **No tiene** integraciones de generación (Hyper3D, Sketchfab, Poly Haven) ni captura de viewport documentada. Por eso:
  - Se modela **por código** (`bpy` + `bmesh` + modificadores), construyendo por piezas.
  - Para **ver** el resultado, se renderiza con Eevee a PNG (`bpy.ops.render.render(write_still=True)` con la cámara colocada por script) en `art/blender/renders/` y se abre el PNG con la herramienta `Read`. **Nunca des un modelo por terminado sin mirar sus renders.**
  - Se exporta con `bpy.ops.export_scene.gltf(...)`.
- Al empezar: lista las herramientas que expone el MCP y anótalas en la bitácora; si hubiera alguna de generación o captura, se puede usar, pero el estilo y los presupuestos de §4.2 mandan.

### 4.2 Especificación del piloto (`driver_<id>.glb`)
**Referencias visuales (obligatorias):** los retratos pixel del juego. Genéralos con `node tools/ui-audit.mjs shots-ref --only=select-1p` (necesita `vite build` + `vite preview`, ver CLAUDE.md) y lee `packages/core/data/characters.json` (colores exactos `helmet/skin/accCol/mouth`, `acc`, `beard`) junto con §2.3 para los nuevos. El modelo tiene que reconocerse como ese retrato **en 3D**: mismos colores planos, mismo casco/pelo y accesorio, ojos grandes.

| Aspecto | Valor exacto |
|---|---|
| Estilo | chibi: cabeza ≈ 45 % de la altura total sentado; ojos grandes con brillo; nariz mínima; boca del color `mouth`. Look plano/cel: materiales Principled BSDF con Roughness 0.8, Metallic 0 y sin texturas; el color sale del material. Contorno: **no** se hace en Blender (lo hace el juego si se decide). |
| Unidades y escala | 1 unidad de Blender = 1 m. Piloto sentado: **altura 0.95 m** desde la base del asiento hasta lo alto del casco o pelo. Antes de modelar, importa `packages/client/src/assets/models/jp_body.glb` + `jp_head.glb` para comparar escala y proporción, y lee cómo `packages/client/src/render/world3d.ts` los carga y escala; si difiere, manda la escala del juego y anota la conversión. |
| Orientación | glTF +Y arriba; el piloto **mira hacia −Y de Blender** (que exporta como +Z… verifica con el importador del juego: en `world3d.ts` el kart avanza hacia su eje local; el piloto debe mirar en la dirección de avance del kart). Origen (0,0,0) = punto de apoyo en el asiento. |
| Topología | LOD0: **4 000-6 000 triángulos** (cuerpo + cabeza + accesorios). LOD1: **≤ 1 500**, como objeto `<id>_LOD1` en el mismo archivo (Decimate + limpieza). Mallas cerradas, normales hacia fuera, shading suave con auto smooth en 30°, sin n-gons en la exportación. |
| Materiales | Máximo **6 por piloto**, con nombres `skin`, `helmet`, `suit`, `hair`, `eyes`, `acc`. Colores tomados del JSON (sRGB → los hex exactos). |
| Rig | Armature `rig` con huesos exactos: `root`, `spine`, `chest`, `neck`, `head`, `upperArm.L`, `forearm.L`, `hand.L`, `upperArm.R`, `forearm.R`, `hand.R`. Sin piernas animadas (van dentro del kart). Pesos automáticos y luego corregidos: la cabeza al 100 % en `head`. Las manos agarran un volante imaginario a 0.35 m delante del pecho. |
| Clips (30 fps) | `idle` (2 s, en bucle, respiración + balanceo leve), `steerL` y `steerR` (0.5 s, pose fija al final, inclinación 15° + brazos), `trick` (0.6 s, brazos arriba + giro de cabeza), `hit` (0.8 s, sacudida + cabeza hacia atrás), `lookBack` (0.4 s, cabeza y torso girados 100° hacia atrás, pose final fija), `victory` (2 s, en bucle, brazos arriba y salto del torso). Los nombres deben ser exactos. |
| Archivo | `packages/client/src/assets/models/driver_<id>.glb` con `<id>` = `marco, guaycaipuro, luis, jesus, miguel, jp, mario, andres, edu, diego, angel, henry`. Exportación: `export_format='GLB'`, `export_apply=True`, `export_animations=True`, `export_yup=True`, sin cámaras ni luces. **Tamaño ≤ 250 KB.** Fuente: `art/blender/driver_<id>.blend`. |
| Rasgos por piloto | Los de `characters.json` (`acc`: mohawk, headphones, tuft, antenna, glasses, spikes; `beard`) + §2.3 para los 4 nuevos. Gorra de Diego con visera hacia delante; lentes de Henry de montura gruesa y oscura; los de Edu, finos. |

### 4.3 Especificación de piezas (`part_<id>.glb`)
- Chasis (`part_kernel/overdrive/mainframe/rover.glb`): **1 500-3 000 triángulos**, ≤ 4 materiales (`body`, `trim`, `seat`, `metal`). El color del cuerpo se tiñe en el juego con el `kart` del piloto, así que el material `body` va en blanco `#ffffff`. **Empties** obligatorios con nombre exacto: `seat` (donde va el piloto), `wheel_FL`, `wheel_FR`, `wheel_RL`, `wheel_RR` (centro de cada rueda) y `glider` (anclaje del ala). Largo ≈ 1.6 m y ancho ≈ 1.1 m (Kernel; las demás formas según §2.4). Compara con el kart actual del juego en una captura.
- Ruedas (`part_std/slick/offroad/mini.glb`): **una sola rueda** centrada en el origen con el eje X como eje de giro, ≤ 600 triángulos, materiales `tire` y `rim`. Diámetro: estándar 0.42 m, slick 0.44 m (ancha), todoterreno 0.5 m, mini 0.3 m.
- Alas (`part_wing/glider/light.glb`): ≤ 800 triángulos, materiales `canvas` (se tiñe) y `frame`; origen = punto de anclaje; abierta, en su tamaño real (la envergadura de la estándar ≈ 2.2 m, la planeadora 3 m, la ligera 1.6 m).
- Tamaño de cada archivo ≤ 80 KB. Fuente: `art/blender/parts.blend`.

### 4.4 Flujo por modelo (repetir para cada uno)
1. Construir por partes con `bpy` (cabeza → casco/pelo → cara → torso → brazos → accesorios), guardando el `.blend`.
2. **Renders de revisión** 1024×1024 con Eevee, fondo gris neutro e iluminación de 3 puntos: frente, espalda, 3/4 y perfil, en `art/blender/renders/<id>_{front,back,34,side}.png`. Ábrelos con `Read` y compáralos con el retrato pixel. Itera hasta que (a) se reconozca al personaje, (b) se vea bien **de frente** (es lo que se ve con la cámara trasera, el defecto actual) y (c) no haya huecos ni normales invertidas.
3. Rig + pesos + los 7 clips. Render de un fotograma de `steerL`, `trick` y `victory` para revisarlos.
4. LOD1, comprobación de triángulos (`len(mesh.loop_triangles)`) y de tamaño, export, y reimportar el `.glb` en una escena vacía para verificar nombres, clips y escala.
5. Commit: `Modelo 3D: <Nombre> (driver_<id>.glb, N tris, X KB)` + los renders.

Orden: **JP primero** (piloto patrón para validar escala y orientación en el juego con una integración mínima de 6b), luego Kernel + Estándar + ala Estándar (el kart por defecto), después los 11 pilotos restantes y por último las piezas restantes.

---

## 5. Archivos que se tocan

```
+ core/data/tunables/stats.json, core/data/parts.json
~ core/data/characters.json, core/data/tunables/{ai,items,driving,race}.json
~ core/src/data/characters.ts, core/src/sim/{world,types,items,helpers}.ts, core/src/items/* (+3), core/src/sim/effectDefs.ts
~ core/src/track/{authored,track}.ts, core/data/tracks/*.json (ramps.kind, chasms), core/tools/{item-odds,ai-balance}.ts, validador de pistas
~ core/src/net/protocol.ts (v7), core/src/meta (perfil +1)
~ server/src/room.ts (12, pick con piezas, timeout)
~ client/src/screens (selector + constructor), hud, render/world3d.ts (glb, mixer, LOD), art/{sprites,codeModels}.ts, public/sw.js, vite.config.ts
~ apps/desktop (protocolo app://)
+ client/src/assets/models/driver_*.glb, part_*.glb · art/blender/*.blend, art/blender/renders/*.png
```

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| El MCP genera modelos feos o deformes | Renders obligatorios + iteración; JP primero como piloto de prueba; el usuario aprueba los renders de JP antes de seguir con el resto. |
| Escala u orientación mal en el juego | Integración mínima de 6b con JP antes de modelar los demás. |
| 12 karts sobrepasan las draw calls en el móvil | LOD1 + tier ahorro; medido en V3-2 y en V3-6. |
| Desync por las piezas | El loadout va en `RaceConfig` (dentro del hash); `lan-check` con piezas distintas y 0 resyncs. |
| Balance roto | `ai-balance` por arquetipo + tope del 15 % de victorias; los números viven en tunables. |
| Bundle enorme por los `.glb` | Fuera del JS; SW + `app://`. |
| Sesión cortada a mitad de una fase | Commit por subtarea + bitácora §11. |

## 7. Checklist de salida

- [ ] V3-1 stats + rebalanceo · [ ] V3-2 12 pilotos/karts · [ ] V3-3 piezas + selector + protocolo 7 · [ ] V3-4 objetos · [ ] V3-5 rampas/cañones · [ ] V3-6a modelos (12 pilotos + 11 piezas) · [ ] V3-6b integración · [ ] V3-7 balance + QA + merge

## 11. Bitácora (el agente añade una línea por fase o subtarea)

| Fecha | Fase | Commit | Medido / notas | Pendiente |
|---|---|---|---|---|
| 2026-10-17 | plan | — | decisiones cerradas en la sesión de preguntas | empezar V3-1 |
| 2026-10-17 | V3-1 | ver `git log` | stats.json + fórmula §2.1 + física (tracción, mini-turbo) + 8 pilotos con stats §2.2 + `stats.test.ts` + golden regenerado; 110 tests y typecheck en verde. Tests viejos adaptados: `autonext` ("velocidad única" contradecía §1) y `mechanics` parapente (vuelo 9 fijado en el test; sin piezas ningún piloto pasa de vuelo 6). **Balance IA sola (72 carreras, 4 pistas, `ai-balance --wins`):** Mario 44 %, Luis 29 %, JP 18 %, Guayca/Jesús/Miguel 3 %, Marco/Andrés 0 %. Causa: las pistas actuales casi no limitan por curva (`man` 10 ahorra 0-5 % de tiempo; `vel` ±1 = 2-5 %); con `vel` 0.015-0.02 el máximo baja a 17-25 %. **Decisión del usuario:** se mantiene el ~8 % (criterio ≤20 % queda para V3-7) y se rehacen ~9 pistas como técnicas en V3-5 (§3 V3-5.4). | V3-2 |
| 2026-10-17 | V3-2 | ver `git log` | Edu/Dieguito/Angelito/Henry (stats §2.2, retratos pixel con `cap` y perilla `goatee`, voxel y modelo por código); IA `limpio` y `caotico` (personality +`lineErr`, `lineFocus`, `hold`, `chaos`); 12 karts: puntos de copa en `race.json`, Eliminación = karts−1 vueltas, selector 4×3, listas de resultados/clasificación/lobby compactas, borde `accCol` en minimapa y lista; servidor 12 humanos. **Medido:** `bun run bench` p95 **0.078 ms** (12 karts, presupuesto 2.0); Valle Python en navegador WebGPU headless: 60 fps, draw calls base 8 karts **149** → 12 karts **202** → con ruedas fusionadas (neumático+tapacubos en 1 malla) **152** (PC ≤80 / móvil ≤60 del plan NO se cumple ni en la base: la mitad del coste es decorado/pistas, queda para V3-6 con LOD1); móvil 188 antes de fusionar. 121 tests, typecheck, `modes-check` (elim 11 vueltas, batalla/captura con 12), `ui-audit` escritorio y `--mobile` 0 problemas (tools: etiquetas 3D de los 12 fuera de la regla de solapes; `modes-check` entra por la pantalla de bienvenida), `lan-check` 2 humanos + 10 IA: 0 resyncs, `room12.test.ts`. Dorados regenerados. Balance IA sola con 12 (48 carreras): Dieguito 40 %, Mario 21 %, Luis/JP 13 % (criterio V3-7). | V3-3 |
| 2026-10-17 | V3-3 | ver `git log` | `parts.json` (4+4+3) + `core/src/data/parts.ts` (validLoadout, randomLoadout, resolveLoadout); fórmula aditiva `kartStats(ch, parts)`; `Kart.st` (números planos calculados una vez al crear el kart: la sim ya no lee CHARS); `RaceConfig.grid[i].parts`; el hash de handshake incluye parts.json y las stats de los pilotos; **sin tocar golden** (partes por defecto = deltas 0). Perfil v2 (`lastCh`, `lastParts`, migración 0→1→2). **Protocolo 7:** `pick{ch, parts}` validado por el servidor (pick inválido se rechaza entero), `LobbyPlayer.parts`, cuenta atrás `pickIn` de 30 s (`race.json pickTime`) desde que el anfitrión pulsa empezar: al llegar a 0 los que no confirmaron reciben piezas aleatorias (RNG del servidor); cambiar ajustes la cancela; si todos confirman arranca ya. Cliente: `screens/picker.ts` (cuadrícula 4×3 → constructor con barras en vivo base amarilla + delta verde/rojo, Aleatorio, Intro; pantalla dividida con un panel por jugador en su cuadrante y su propia fuente de input; constructor en el lobby con K / ↑ y kart recordado al entrar). 151 tests (+parts, profile, room12, server parts), typecheck, `ui-audit` escritorio y móvil 0 problemas (52 pantallas, incluye selector 1/2/4 y constructor), `lan-check` con piezas distintas (Overdrive+Mini+Planeadora vs Rover+Mini+Ligera): mismo estado, 0 resyncs; `split-check` 2 y 4 jugadores; `picker-check` (nuevo). Herramientas actualizadas al perfil/bienvenida: `modes-check`, `split-check`, `roster-check`. **Pendiente / límites:** la vista previa del constructor es el kart voxel girando (las piezas no tienen forma propia hasta los `.glb` de V3-6b; las barras sí reflejan las piezas); las IA y los asientos extra de red llevan el kart por defecto (se aleatorizan en V3-7 si el balance lo pide); en móvil el selector se maneja con el pad de menús (objetivos grandes del DOM). | V3-4 |
