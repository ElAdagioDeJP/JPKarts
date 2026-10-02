# JP Kart — Backlog de mecánicas

> Backlog priorizado. El diseño de cada entrada está en `docs/GDD.md` (sección indicada); el orden de ejecución en `docs/PLAN.md`.
> **Definición de terminado de cualquier mecánica:**
> - es datos + registro (no toca `updateKart`);
> - sus valores están en tunables;
> - emite eventos y el client hace el feedback;
> - tiene **test de replay/hash** y pasa el smoke test de red con latencia simulada (desde la Fase 6);
> - la IA la entiende (`aiScore` o consideración táctica);
> - está en español.

**Leyenda**
- **Prioridad:** Must = sin esto no hay v2 · Should = muy deseable · Could = si sobra tiempo.
- **Esfuerzo:** S ≤ 1 día · M 2–4 días · L ≥ 1 semana (tiempo parcial).
- **Riesgo:** B = balance · R = red (desincronización, predicción, ancho de banda). Valores: bajo/medio/alto.
- **Fase:** número de fase en `PLAN.md`. 8a–8d = lotes de producción (una copa por lote).

## Estado (2026-10-02)
- **Hechas (Fases 2–7):** #1–#17, #19–#21, #34–#36, #39, #43–#55; #37 y #38 en su parte de olas y marea.
- **Hechas (Fase 8):** #16 (hielo y arena), #18, #22–#33, #37 (14 peligros en 6 familias: cruces, aspas, erupciones, rodantes, setas y compuertas), #38 (lava que sube, nieve que estrecha, compuertas por vuelta), #40, #41, #42 (16 pistas autoradas que pasan el validador).
- **Desviación:** #22 no "suelta el objeto sostenido" porque no existen objetos sostenidos detrás; la onda aplica un golpe leve.
- **Hechas (Fase 9):** #56–#62 (Contrarreloj con fantasmas, Eliminación, Equipos, Globos con 4 arenas, Captura, progresión con 150cc/Espejo y guardado versionado, repetición final). La bandera de Captura también cambia de manos con un choque: sin eso apenas pasaba de un kart a otro.
- **Hecha (Fase 10):** #63 pantalla dividida local de 2 a 4 jugadores, también mezclada con LAN y online.

## Sistemas base

| # | Mecánica | Tipo | Prio | Depende de | Esf. | Riesgo | Fase | GDD |
|---|---|---|---|---|---|---|---|---|
| 1 | Replays `seed + inputs` y hash del estado | Sistema | Must | — | M | B bajo · R bajo | 2 | §5 |
| 2 | Sistema de efectos (tags, inmunidades, modifiers, stacking) | Sistema | Must | 1 | M | B bajo · R medio | 3 | §4.2 |
| 3 | Lista única de entidades + registro de kinds + pools | Sistema | Must | 1 | M | B bajo · R medio | 3 | §4.2 |
| 4 | Bus de eventos tipado (core → client) | Sistema | Must | — | S | B bajo · R bajo | 3 | §4.4 |
| 5 | Registro de objetos `defineItem` + migración de los 15 sin cambiar su comportamiento | Sistema | Must | 2, 3, 4 | L | B bajo · R medio | 3 | §3.1 |
| 6 | Modos como reglas `defineMode` (Carrera y Copa portados) | Sistema | Must | 4 | M | B bajo · R bajo | 3 | §5 |
| 7 | Tunables JSON con recarga en caliente (dev) | Sistema | Must | — | S | B bajo · R medio | 3 | §2 |
| 8 | Reparto de objetos v2: enfriamiento global tier alto, sin repetición, el 1º sin tier ≥ 8 | Objetos | Must | 5 | S | B medio · R bajo | 4 | §3.1 |
| 9 | Telegrafía `incoming` + indicador de borde | Sistema | Must | 4 | S | B bajo · R bajo | 4 | §3.1 |

## Conducción

| # | Mecánica | Tipo | Prio | Depende de | Esf. | Riesgo | Fase | GDD |
|---|---|---|---|---|---|---|---|---|
| 10 | Drift con 3 niveles de mini-turbo (azul/naranja/morado) | Conducción | Must | 7 | S | B bajo · R bajo | 4 | §2.2 |
| 11 | Turbo de salida (ventanas + quemar rueda) | Conducción | Must | 4 | S | B bajo · R bajo | 4 | §2.3 |
| 12 | Trucos en rampas con turbo al aterrizar | Conducción | Must | 4 | M | B bajo · R bajo | 4 | §2.4 |
| 13 | Rebufo (slipstream) | Conducción | Must | 2 | M | B medio · R bajo | 4 | §2.5 |
| 14 | Muros con rebote + anti-tunneling | Conducción | Must | 34 | M | B bajo · R medio | 4 | §2.6 |
| 15 | Golpes por niveles + invulnerabilidad 1 s + recuperación activa | Conducción | Must | 2 | S | B bajo (mejora la justicia) · R bajo | 4 | §2.7 |
| 16 | Superficies: barro, charco, hielo, arena | Conducción | Must | 34 | M | B bajo · R bajo | 4 (barro, charco) · 8b (resto) | §2.8 |
| 17 | Clases de peso aplicadas a choques y recuperación | Conducción | Must | 2 | S | B medio · R bajo | 4 | §8 |
| 18 | Monedas (+1,2 % por moneda, se pierden 3 por golpe) | Sistema | Should | 3 | M | B medio · R bajo | 8a | §4.1 |

## Objetos

| # | Mecánica | Tipo | Prio | Depende de | Esf. | Riesgo | Fase | GDD |
|---|---|---|---|---|---|---|---|---|
| 19 | **Muelle** (supersalto; atajos `needs:"muelle"`) | Objeto · movilidad | Must | 5, 34 | M | B medio · R medio | 4 | §3.3 |
| 20 | **Mina de Proximidad** | Objeto · trampa | Must | 3, 5 | S | B bajo · R bajo | 4 | §3.3 |
| 21 | **Escudo Reflector** | Objeto · defensa | Must | 2, 5 | M | B medio · R medio | 4 | §3.3 |
| 22 | Rework Bocina (onda: golpe leve y suelta el objeto sostenido) | Objeto · caos | Must | 5 | S | B medio · R bajo | 8a | §3.2 |
| 23 | Caja Falsa (reemplaza la Mancha de Aceite: afecta a todos) | Objeto · trampa | Must | 5 | S | B bajo · R bajo | 8a | §3.2 |
| 24 | Ajustes legacy: Burbuja, Inversor 3 s, PEM solo delante, Agujero 320 u, Cuántico con aviso | Objeto · balance | Must | 5, 9 | M | B alto · R bajo | 8a | §3.2 |
| 25 | Turbo Bala (reemplaza Teletransporte al 1º) | Objeto · movilidad | Should | 5, 43 | M | B alto · R medio | 8a | §3.2 |
| 26 | Turbo Triple | Objeto · movilidad | Should | 5 | S | B bajo · R bajo | 8a | §3.3 |
| 27 | Triple Ciego (orbitan y bloquean) | Objeto · ataque/defensa | Should | 3, 5 | M | B medio · R medio | 8b | §3.3 |
| 28 | Bumerán | Objeto · ataque | Should | 3, 5 | M | B medio · R medio | 8b | §3.3 |
| 29 | Cadena de Rayos | Objeto · ataque | Should | 5 | S | B medio · R bajo | 8c | §3.3 |
| 30 | Imán de Monedas | Objeto · economía | Could | 18 | S | B bajo · R bajo | 8b | §3.3 |
| 31 | Bloque de Hielo | Objeto · trampa | Could | 16 | S | B bajo · R bajo | 8c | §3.3 |
| 32 | Cortina de Humo (vista del local + precisión de la IA) | Objeto · caos | Could | 2, 44 | M | B medio · R bajo | 8c | §3.3 |
| 33 | Ráfaga (empuje lateral; puede tirar al agua) | Objeto · caos | Could | 17 | S | B **alto** · R medio | 8d | §3.3 |

## Pistas

| # | Mecánica | Tipo | Prio | Depende de | Esf. | Riesgo | Fase | GDD |
|---|---|---|---|---|---|---|---|---|
| 34 | Formato de pista autorada (spline + secciones + muros + superficies) y bake | Pista | Must | 1 | L | B bajo · R bajo | 4 | §6.1 |
| 35 | Validador de pistas en CI (geometría, métricas de copa, la IA completa la vuelta) | Herramienta | Must | 34, 43 | M | — | 4 | §6.5 |
| 36 | Visor/editor de pista en modo debug | Herramienta | Should | 34 | M | — | 4 | §6.5 |
| 37 | Peligros temporizados genéricos (tren, aspas, olas, géiseres, autos) | Pista · dinámica | Must | 3 | M | B medio · R medio | 4 (olas) · 8a–8d | §4.3 |
| 38 | Cambios entre vueltas (marea, lava, nieve que estrecha, compuertas) | Pista · dinámica | Must | 34, 37 | M | B medio · R bajo | 4 (marea) · 8b–8d | §4.3 |
| 39 | Atajos y bifurcaciones reales con coste | Pista | Must | 34 | S | B medio · R bajo | 4 | §6.1 |
| 40 | Clima: lluvia (agarre), niebla, tormenta de arena | Pista · dinámica | Should | 2, 49 | M | B medio · R bajo | 8b | §4.3 |
| 41 | Día → noche durante la carrera | Presentación | Could | 49 | S | — | 8b | ART §5 |
| 42 | 16 pistas autoradas (lotes de 4 por copa) | Contenido | Must | 34, 35 | L×4 | B medio · R bajo | 8a–8d | §6.4 |

## IA

| # | Mecánica | Tipo | Prio | Depende de | Esf. | Riesgo | Fase | GDD |
|---|---|---|---|---|---|---|---|---|
| 43 | Racing line precalculada + líneas alternativas + perfil de velocidad | IA · navegación | Must | 34 | M | B medio · R bajo | 4 | §7.1 |
| 44 | Táctica utility a 5 Hz (adelantar, bloquear, esquivar, rebufo, atajo) | IA · táctica | Must | 43 | L | B medio · R bajo | 4 | §7.2 |
| 45 | `aiScore` por objeto (sustituye `useAt` aleatorio) | IA · objetos | Must | 5 | M | B medio · R bajo | 4 | §7.3 |
| 46 | Personalidades por personaje (datos) | IA | Should | 44 | S | B bajo · R bajo | 4 | §7.4 |
| 47 | Dificultad explícita + rubber-band suave acotado | IA | Must | 43 | S | B alto · R bajo | 4 | §7.5 |
| 48 | Overlay de depuración de IA | Herramienta | Must | 44 | S | — | 4 | §7.6 |

## Presentación, input y modos

| # | Mecánica | Tipo | Prio | Depende de | Esf. | Riesgo | Fase | GDD |
|---|---|---|---|---|---|---|---|---|
| 49 | Render Three.js WebGPU v2 (decorado instanciado + post-proceso TSL) | Render | Must | 4 | L | — | 5 | ART §5 |
| 50 | Partículas por eventos (polvo, chispas, agua, nieve, lava) | Feel | Must | 4, 49 | M | — | 5 | ART §6 |
| 51 | Cámara v2 (lookahead, salto, turbo, trauma shake) | Feel | Must | 4 | S | — | 5 | ART §7 |
| 52 | HUD v2 (minimapa con rivales, `incoming`, posición grande) + pila de pantallas | UI | Must | 4, 9 | M | — | 5 | ART §9 |
| 53 | Mando (Gamepad API) + acciones + remapeo | Input | Must | — | M | R bajo | 5 | §10 |
| 54 | Audio por buses + música adaptativa + motores posicionales | Audio | Should | 4 | M | — | 5 | ART §8 |
| 55 | Accesibilidad (daltónico, reducir sacudida/destellos, tamaño de HUD) | UI | Must | 52 | S | — | 5 | ART §10 |
| 56 | Contrarreloj con fantasmas | Modo | Should | 1 | M | — | 9 | §5 |
| 57 | Eliminación | Modo | Should | 6 | S | B bajo · R bajo | 9 | §5 |
| 58 | Equipos (sin fuego amigo) | Modo | Could | 6 | S | B medio · R bajo | 9 | §5 |
| 59 | Batalla — Globos + 4 arenas | Modo | Could | 6, 34 | L | B medio · R medio | 9 | §5, §6.6 |
| 60 | Batalla — Captura | Modo | Could | 59 | S | B medio · R medio | 9 | §5 |
| 61 | Progresión, desbloqueos, 150cc/Espejo, récords y guardado versionado | Meta | Should | 56 | M | — | 9 | §9 |
| 62 | Repetición final con cámara de highlights | Feel | Could | 1, 51 | M | — | 9 | ART §7 |
| 63 | Pantalla dividida local (2–4) | Input/Render | Could | 49, 53 | L | — | 10 | §10 |

**Total: 63 entradas.**
- Must: 40 · Should: 13 · Could: 10.
- La numeración es estable para referenciarla en commits (`backlog #20`). Las entradas nuevas se añaden al final (64, 65…); no se renumera.

## Orden de ataque recomendado dentro del vertical slice (Fase 4)

Se sigue el orden de dependencias. Cada paso termina con su test de replay:

1. 34 (formato de pista) → 39 (atajos) → 43 (racing line) → 35 (validador)
2. 10 → 11 → 12 → 15 → 17 → 13 → 14 → 16 (barro, charco)
3. 8 → 9 → 19 (Muelle) → 20 (Mina) → 21 (Escudo Reflector)
4. 44 → 45 → 46 → 47 → 48
5. 37 (olas) → 38 (marea)
