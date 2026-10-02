# JP Kart — Documento de diseño (GDD)

> Versión 2 · Fuente de verdad de **qué** es el juego. El **cómo** está en `docs/PLAN.md`, la dirección de arte en `docs/ART_BIBLE.md` y el backlog priorizado en `docs/MECHANICS_BACKLOG.md`.
> Todos los números de este documento son **valores iniciales de tunables** (`core/data/tunables/*.json`), no constantes en código. Se ajustan jugando.
> Skills de referencia usadas para este documento: `physics-tuning`, `game-feel`, `input-systems`, `camera-systems`, `game-ai`, `ai-behavior-trees-utility-ai`, `level-design`, `procedural-gen`, `save-systems`, `audio-design`, `game-ui-ux`.

---

## 1. Visión, pilares y público

**Frase:** carreras de karts pixel art en LAN entre amigos: caóticas, ruidosas y justas; cualquiera puede ganar la última vuelta, pero el que conduce mejor gana más veces.

### Pilares
1. **Caos justo.** Los objetos dan vuelcos, pero todo golpe se **telegrafía** (sonido + icono + tiempo de reacción ≥ 0,4 s) y tiene **contrajuego**. Ningún objeto elimina la habilidad: después de un golpe hay 1 s de invulnerabilidad para que no haya cadenas de golpes.
2. **Conducción con techo alto.** Fácil de agarrar (acelerar + girar) y profunda de dominar: drift por niveles, turbo de salida, trucos, rebufo, líneas y atajos con coste.
3. **Pistas con personalidad.** Cada pista tiene un gimmick que cambia cómo se corre (marea, tren, lava que avanza…), con intención de diseño por sección, no curvas al azar.
4. **Sofá en red.** Pensado para LAN: entrar en una partida en < 30 s, partidas de 2:30–3:00, todo legible a distancia en un monitor compartido.

### Público
Grupos de amigos (2–8 humanos) en la misma red, la IA rellena hasta 8. Jugadores casuales y competitivos en la misma sala: la dificultad viene de la IA y de la clase de velocidad, no de castigar al que va atrás.

### Antipilares (lo que NO hacemos)
- Rubber-band que se note (teletransportes, IA que acelera 30 % de la nada).
- Objetos que quitan el control sin aviso o durante más de 3 s.
- Contenido que no se pueda describir como datos (si una mecánica necesita tocar `updateKart`, la arquitectura está mal).

---

## 2. Conducción

Simulación a **60 Hz fijos** en `core`; el render interpola. Todo lo de abajo son tunables en `tunables/driving.json`. Los valores salen del legacy (`legacy/jp-kart.html`, `updateKart`) y se marcan con **(legacy)** cuando se conservan.

### 2.1 Base
| Parámetro | Valor inicial | Nota |
|---|---|---|
| Velocidad máxima base | `142 × spd` u/s **(legacy)** | `spd = 0,85 + vel × 0,03` |
| Aceleración | `112 × acl` u/s² **(legacy)** | `acl = 0,75 + ace × 0,05`; ×3 si va en reversa |
| Freno / coast | 260 / 55 u/s² **(legacy)** | |
| Reversa máx. | −45 u/s **(legacy)** | |
| Giro | `2,2 × hnd` rad/s a velocidad plena **(legacy)** | `hnd = 0,8 + man × 0,04` |
| Pendiente | −230 × pendiente **(legacy)** | las subidas frenan, las bajadas empujan |
| Clase de velocidad | 50cc ×0,85 · 100cc ×1,0 · 150cc ×1,15 · Espejo = 150cc reflejado | multiplica velocidad y aceleración de todos |

### 2.2 Drift y mini-turbo por niveles
- Se inicia con **Derrapar** + giro > 0,3 a > 80 u/s **(legacy)**, con un salto corto (hop 0,14 s).
- La carga sube 1,3/s si el giro va hacia el drift y 0,8/s si va contra él **(legacy)**. Barro y hielo la multiplican por 0,5 y 0,8.
- Niveles (nuevo nivel 3):

| Nivel | Carga | Chispas | Turbo |
|---|---|---|---|
| 1 | 0,75 s | azul `#3df0ff` | 0,55 s **(legacy)** |
| 2 | 1,5 s | naranja `#ff8a1f` | 1,0 s **(legacy)** |
| 3 | 2,4 s | morado `#b84aff` | 1,5 s |

- El turbo sube la velocidad máxima ×1,42 y empuja +320 u/s² **(legacy)**.
- Soltar antes del nivel 1 no da nada. Salir de pista (off = 2) o recibir un golpe cancela el drift sin turbo.

### 2.3 Turbo de salida
Durante la cuenta atrás:
- Pulsar acelerar en la ventana **[1,0 s; 0,6 s]** antes del "¡YA!" da turbo de 1,0 s.
- En la ventana **[0,6 s; 0,3 s]** da turbo de 0,5 s.
- Mantener acelerado desde antes de 2,0 s **quema rueda**: 0,8 s sin aceleración.
- Feedback (en el client): humo, tono que sube y destello en el kart.

### 2.4 Rampas y trucos
- Al despegar de una rampa (o de un salto natural del terreno con vz > umbral) se abre una ventana de 0,25 s para pulsar **Derrapar** = truco (animación de giro).
- Truco aterrizado = turbo 0,6 s. Truco en rampa marcada como "grande" = 0,9 s.
- Si recibes un golpe en el aire, el truco se pierde.
- Las rampas de **vuelo** del legacy (planeo) se conservan: el stat **Vuelo** sigue decidiendo la velocidad de planeo (`0,75 + vue × 0,055` de la base **(legacy)**).

### 2.5 Rebufo (slipstream)
- Se carga si hay un kart delante a ≤ 70 u, en un cono de ±12°, y vas a > 100 u/s.
- La carga llega a 1,2 s; luego da turbo 0,8 s.
- La carga se vacía al doble de velocidad si sales del cono.
- Feedback: líneas de viento cuya opacidad sigue a la carga.
- La IA lo usa como acción táctica (§7).

### 2.6 Muros y rebote
Las pistas autoradas tienen **bordes duros** (polilíneas `walls` en los datos de la pista) en algunas secciones y bordes blandos (fuera de pista) en otras.
- Choque contra un muro: se refleja la componente normal de la velocidad ×0,35, se pierde 25 % de la velocidad y **no hay giro**.
- Si el ángulo de choque es > 60°, hay 0,25 s sin poder girar.
- Parachoques de Goma activo: el rebote ×0,8 y sin pérdida de velocidad.
- Anti-tunneling: la velocidad máxima entre ticks debe ser < grosor del muro; si no, se hace barrido del segmento (`physics-tuning`).

### 2.7 Golpes y recuperación
Tres niveles de golpe:
- **Leve:** giro de 0,6 s, conserva el 50 % de la velocidad.
- **Normal:** giro de 1,0 s, el kart se para. Equivale al `hit(k,1.0)` del legacy.
- **Fuerte:** volteo de 1,5 s.

Además:
- Al recuperarse: **1,0 s de invulnerabilidad** (parpadeo) y se pierden 3 monedas.
- **Recuperación activa:** si machacas acelerar durante el giro, se recorta hasta 20 %. Premia la reacción, no la suerte.
- Caída a líquido o vacío: 1,2 s de respawn **(legacy)** en el último punto válido de la línea, con 1,0 s de invulnerabilidad.

### 2.8 Superficies
Las superficies se pintan en los datos de la pista (regiones o máscara) y viven en `tunables/surfaces.json`:

| Superficie | Vel. máx | Agarre | Carga drift | Extra |
|---|---|---|---|---|
| Asfalto/pista | 1,0 | tema (≈ 4–8 **legacy** `th.grip`) | 1,0 | — |
| Borde (off = 1) | 105 u/s fijo **(legacy)** | 1,0 | 1,0 | — |
| Hierba / fuera (off = 2) | `th.offMax` **(legacy)** | 6 **(legacy)** | 0 (cancela) | polvo |
| Arena | 0,75 | 0,8 | 0,8 | sacude la cámara (poco) |
| Barro | 0,6 | 0,9 | 0,5 | salpica la pantalla del local (client) |
| Hielo | 1,0 | 0,35 | 0,8 | el drift dura más |
| Charco | 0,85 durante 0,4 s | 0,7 | 1,0 | salpicadura |
| Acelerador | turbo 0,8 s **(legacy)** | — | — | enfriamiento 0,5 s por kart |
| Lluvia (clima) | — | ×0,8 en toda la pista | — | se acumula con la superficie |

---

## 3. Objetos

### 3.1 Reglas generales
- **Cajas de objeto:** filas en la pista (el legacy usa 4 filas), reaparecen a los 3 s **(legacy)**. La ruleta dura 1,0 s para humanos **(legacy)** y es instantánea para la IA, pero la IA espera su tiempo de reacción.
- **Probabilidad:** `peso_base × (suerte/5)^t × (0,35 + 2,65 × posRel)^t` con `t = 2 × tier/(n−1)` **(legacy)**. Ningún objeto llega a 0.
- **Límites nuevos contra el caos injusto** (en `tunables/items.json`):
  - **Enfriamiento global por tier alto:** tras usarse un objeto de tier ≥ 10, ningún otro de tier ≥ 10 puede salir en 12 s.
  - **Sin repetición:** el mismo jugador no recibe el mismo objeto dos veces seguidas (salvo los comunes).
  - **El 1º nunca** recibe tier ≥ 8.
- **Telegrafía obligatoria:** todo objeto que afecta a un rival emite un evento `incoming` con al menos 0,4 s de antelación (salvo los proyectiles visibles en pantalla).
- **Definición como datos:** cada objeto es un archivo en `core/items/<id>.ts` que se registra con:
  ```ts
  defineItem({ id, nameEs, role, tier, weight, onUse(ctx), aiScore(ctx), counters: [...] })
  ```

### 3.2 Revisión de los 15 actuales

| # | Objeto | Rol | Diagnóstico | Cambio propuesto | Contrajuego |
|---|---|---|---|---|---|
| 1 | Bocina de Confusión | Caos | **No hace nada jugable** (solo muestra `¡!`) | Onda de 160 u: los karts dentro hacen un golpe leve y sueltan su objeto si lo llevaban detrás | Burbuja, Juggernaut, alejarse al oír el aviso |
| 2 | Mancha de Aceite Falsa | Trampa | Solo afecta al humano; la IA es inmune; en red sería injusto | **Caja Falsa**: parece una caja de objeto (con un detalle distinguible: `?` invertido); quien la toca hace un golpe leve. Afecta a todos | Mirar el detalle, Burbuja, pasar por el lado |
| 3 | Parachoques de Goma | Defensa | Bien | 12 s; además rebota contra muros sin perder velocidad | Proyectiles (no protege de ellos) |
| 4 | Proyectil Ciego | Ataque | Bien; muere al salir de pista | Rebota hasta 2 veces en muros; vida de 3 s **(legacy)** | Esquivar, Burbuja, objeto detrás |
| 5 | Escudo de Burbuja | Defensa | Explota al salir de pista: regla confusa | Solo explota con golpes; dura hasta el golpe o 20 s | Golpes de nivel ≥ 2 la atraviesan **(legacy)** |
| 6 | Inyector Nitro Básico | Movilidad | Bien | Igual (turbo 1,1 s) **(legacy)** | — |
| 7 | Charco de Alquitrán | Trampa | Bien | 10 s, radio 26 **(legacy)**; se puede saltar con truco/hop | Hop en el borde, Juggernaut |
| 8 | Dron Rastreador | Ataque | Bien (sigue la pista hacia el de delante) | Se telegrafía al objetivo con `incoming` 0,8 s antes | Burbuja, Goma, objeto detrás, hop en el último instante (ventana 0,15 s) |
| 9 | Gancho Electromagnético | Movilidad/Ataque | Bien | Igual, pero se rompe si el objetivo usa un turbo | Turbo/drift nivel 2+ |
| 10 | Inversor de Controles | Caos | 5 s invertido es frustrante con humanos | 3 s, solo a los 3 karts inmediatamente delante, aviso de 0,5 s, icono y cuenta en el HUD | Juggernaut, Burbuja lo absorbe |
| 11 | Rayo PEM | Caos | Global y fuerte | Solo afecta a los de delante; 2 s sin acelerar ni turbo | Juggernaut; la Burbuja reduce a 1 s |
| 12 | Blindaje de Juggernaut | Defensa/Ataque | Bien (estrella) | 8 s **(legacy)** | Alejarse; nada lo detiene |
| 13 | Agujero Negro Portátil | Caos | Borra objetos y escudos en 500 u: muy fuerte | Radio 320; borra trampas/proyectiles y escudos, **no** el objeto en mano | Estar lejos |
| 14 | Intercambio Cuántico | Caos | Gracioso pero castiga al de delante sin aviso | Aviso de 1,0 s al objetivo; se cancela si el objetivo tiene Burbuja/Juggernaut o si quedan < 10 % de carrera | Burbuja, Juggernaut |
| 15 | Teletransporte al 1º | Movilidad | Elimina la conducción: **reemplazar** | **Turbo Bala:** 5 s de piloto automático por la racing line a ×1,6, golpeando lo que toque; termina 1 posición detrás del líder como máximo | Apartarse; Juggernaut |

### 3.3 Objetos nuevos (11)

`aiScore` devuelve 0..1 a partir de consideraciones normalizadas (§7.3). La columna "Peso por posición" dice a quién favorece la curva.

| Objeto | Rol | Efecto | Contrajuego | aiScore (consideraciones clave) | Peso por posición |
|---|---|---|---|---|---|
| Triple Ciego | Ataque/Defensa | 3 proyectiles orbitan y bloquean golpes por detrás; se disparan uno a uno | Golpe lateral; Agujero Negro | rival en cono delante; amenaza detrás | medio |
| Muelle | Movilidad | Supersalto de 0,8 s; salta trampas, huecos y algunos atajos marcados `needs:"muelle"` | — | trampa/proyectil cerca; entrada de atajo-muelle a < 120 u | medio-atrás |
| Imán de Monedas | Economía | Atrae monedas en 120 u durante 4 s y roba 2 monedas al rival más cercano | Distancia | monedas < 10; rival cerca | delante-medio |
| Mina de Proximidad | Trampa | Se suelta detrás, se arma en 1 s, explota en 40 u (golpe normal) | Verla (parpadea), Burbuja | rival detrás a < 200 u; sección estrecha | delante |
| Cortina de Humo | Defensa/Caos | Nube de 3 s detrás: tapa la vista de los locales y **baja la precisión de línea de la IA** | Rodearla | rival pegado detrás | delante |
| Bumerán | Ataque | Va 220 u y vuelve; puede golpear dos veces; se puede atrapar al volver para reusarlo una vez | Esquivar | rival delante a 80–220 u | medio |
| Turbo Triple | Movilidad | 3 nitros consecutivos | — | recta delante o tramo de hierba recortable | atrás |
| Escudo Reflector | Defensa | 6 s: el siguiente proyectil vuelve a quien lo lanzó | Trampas (no las refleja) | evento `incoming` recibido | delante |
| Cadena de Rayos | Ataque | Golpe leve al de delante y salta hasta 2 karts más a < 150 u entre sí | Separarse | grupo compacto delante | atrás |
| Ráfaga | Caos | Cono lateral de 100 u que empuja a los karts 30 u hacia un lado (puede sacarlos de pista o tirarlos al agua) | Pesados se mueven menos; Juggernaut inmune | rival al lado; borde con caída cerca | medio |
| Bloque de Hielo | Trampa | Parche de hielo de 8 s, radio 30 (agarre 0,35) | Pasar recto sin girar | curva justo detrás | delante-medio |

> **Nota de alcance:** 26 objetos son muchos para leer en pantalla. Recomiendo activar **18 en el pool por defecto** (rotables por datos) y dejar el resto en un pool "Caos total" del menú de reglas. Lo decide la telemetría de playtests.

---

## 4. Sistemas

### 4.1 Monedas
- Monedas sueltas en la pista (líneas de 3–5, más en las líneas difíciles).
- Cada moneda da **+1,2 % de velocidad máxima**, hasta 10 (+12 %). La primera moneda da además un mini-turbo de 0,2 s.
- **Se pierden 3 monedas por golpe**: caen al suelo durante 4 s y cualquiera las puede recoger.
- En contrarreloj: arrancas con 10 y no hay monedas en la pista.

### 4.2 Estados/efectos (sistema de efectos)
Todo lo que hoy son campos sueltos (`goma`, `bubble`, `jug`, `inv`, `emp`, `scare`, `hookT`, `slowT`, `spin`, `boost`, `smudge`…) pasa a ser **efectos**.

Cada kart tiene la lista:
```ts
effects: { type, t, stacks, src }[]
```

Cada efecto se define así:
```ts
defineEffect({
  type, duration, stacking: 'refresh'|'add'|'max'|'ignore',
  tags: ['shield','hit','control','speed',...],
  blocks: [tags],          // inmunidades que otorga
  modifiers: { maxSpeed: ×, accel: ×, grip: ×, steer: ×, steerInvert: bool, throttleLock: bool },
  onApply, onTick, onExpire // opcionales, deterministas
})
```

Las stats finales de cada tick salen de `base × Π(modifiers)`. Ejemplos de inmunidades:
- `juggernaut` bloquea `hit` y `control`.
- `burbuja` consume un `hit` de nivel 1.
- `invuln` (post-golpe) bloquea `hit`.

### 4.3 Eventos dinámicos en pista
Los define cada pista como **entidades de pista** con su propio reloj, deterministas con la semilla de la carrera:
- Obstáculos móviles: rocas rodantes, tren, compuertas, aspas, géiseres, autos.
- Cambios entre vueltas: marea, lava, nieve que estrecha la pista, compuertas que alternan la ruta.
- Clima: lluvia, niebla, tormenta de arena, día→noche.

Reglas de diseño:
- Todo peligro avisa ≥ 1,0 s antes con sonido + animación.
- En la vuelta 1 se presenta en un lugar seguro: se **enseña y luego se pone a prueba** (`level-design`).

### 4.4 Eventos de core (contrato con el client)
Core no dibuja ni suena. Emite eventos tipados y el client decide el feedback:

`countdown, go, rocketStart, driftStart, driftLevel, miniTurbo, trick, slipstreamReady, coin, itemRoll, itemGet, itemUse, incoming, hit, shieldPop, wallBump, fall, respawn, lap, finalLap, finish, hazardWarn, hazardTrigger, weatherChange, positionChange, eliminated`.

El client los traduce con presets por importancia:
- **Pequeño:** sonido + partículas.
- **Medio:** + shake 0,3 + destello.
- **Grande:** + hit-stop **visual** de 60 ms (solo en el render; la sim no se para).

---

## 5. Modos de juego

Cada modo es un archivo `core/modes/<id>.ts` registrado con:
```ts
defineMode({ id, setup(world, cfg), scoring(world, ev), endCondition(world), hud: [...] })
```

| Modo | setup | scoring | endCondition | Notas |
|---|---|---|---|---|
| Carrera | parrilla, 3 vueltas, IA hasta 8 | posición final | todos los humanos terminan o 25 s después del 1º | base de todo |
| Copa | 4 carreras de una copa | `POINTS = [15,12,10,8,6,4,2,1]` **(legacy)** | 4ª carrera terminada | parrilla de la siguiente carrera según los puntos **(legacy)** |
| Contrarreloj | 1 kart, 10 monedas, 3 Turbo Triple | tiempo; fantasma = replay del récord | 3 vueltas | los fantasmas salen gratis de los replays (`seed + inputs`) |
| Batalla — Globos | arena, 3 globos por kart | perder globo al recibir un golpe; robar globo con Turbo/Juggernaut | 1 en pie o 3 min | **necesita arenas** (§6.6) |
| Batalla — Captura | arena, 1 bandera | segundos con la bandera | 60 s acumulados o 3 min | |
| Eliminación | carrera de N vueltas = jugadores − 1 | — | el último al cruzar meta en cada vuelta queda fuera; avisos a 10 s | funciona con las pistas normales |
| Equipos | 2 equipos (rojo/azul), colores en el kart | suma de puntos de copa por equipo; el fuego amigo no golpea | igual que Carrera/Copa | modificador sobre Carrera/Copa |

---

## 6. Pistas

### 6.1 De procedural a autoradas
El legacy genera el trazado con `genLayout(seed)` y los atajos con `findBranches` (hoy desactivado: `tr.branches=[]`). Se pasa a **pistas autoradas como datos** (`core/tracks/<id>.json`):

```jsonc
{
  "id": "pradera-jp", "nameEs": "Pradera JP", "cup": "hoja", "theme": "grass",
  "world": 3072,
  "spline": [{ "x":..., "y":..., "h":..., "w":48, "bank":0 }, ...],   // Catmull-Rom centrípeta, cerrada
  "sections": [{ "from":0.00, "to":0.08, "type":"recta",   "intent":"salida y primera caja" },
               { "from":0.08, "to":0.15, "type":"horquilla","intent":"enseñar drift nivel 2" }, ...],
  "walls":    [{ "side":"out", "from":0.30, "to":0.42 }],
  "surfaces": [{ "kind":"barro", "poly":[...] }],
  "branches": [{ "from":0.55, "to":0.61, "spline":[...], "needs":null, "risk":"hierba" }],
  "items":    [0.18, 0.43, 0.68, 0.90], "coins": [...], "pads": [...], "ramps": [...],
  "hazards":  [{ "kind":"tren", "at":0.72, "period":14, "warn":1.5 }],
  "laps":     { "2": [{ "op":"flood", "region":"playa" }], "3": [...] },
  "weather":  { "kind":"lluvia", "from":"lap2" },
  "decor":    { "seed": 11, "rules": "grass-default" }   // procedural SOLO para decorado
}
```

El procedural queda para: decorado (scatter con blue-noise), textura de detalle, variaciones de terreno fuera de pista y cielo. Siempre con la semilla de la pista.

### 6.2 Tipos de sección (vocabulario del diseñador)
- `recta` (adelantar, rebufo, cajas)
- `chicane` (técnica)
- `horquilla` (drift nivel 2–3)
- `curva-rapida` (sin freno, línea)
- `salto` (truco)
- `riesgo` (borde con caída, recompensa = línea corta)
- `atajo` (con coste: hierba, muelle, peligro)
- `descanso` (respirar antes del clímax)
- `climax` (gimmick a tope)

Cada pista se lee como una curva de tensión (`level-design`): sube en dientes de sierra, con descanso antes de la sección clímax.

### 6.3 Duración y métricas
- **Objetivo: vuelta de 50–60 s → carrera de 2:30–3:00.**
  - Hoy el lap ronda 43 s (`TRACK_LEN = 6100` a ≈ 140 u/s).
  - Hacen falta trazados de 7.000–8.500 u, así que el mundo crece de `TS = 2048` a **3072** (heightmap 768²).
  - La copa Fuego puede llegar a 3:15.
- **No recomiendo 3:30.** Una copa de 4 carreras pasaría de 15 min con menús, y en LAN la gente se cansa. Con 3:00 la copa queda en ~13 min.

Métricas por copa (las comprueba el validador, §6.5):

| Copa | Semiancho de pista | Curvas cerradas/vuelta | Peligros/vuelta | Caídas posibles | Muros |
|---|---|---|---|---|---|
| Hoja | 48–52 | 2–3 | 0–1 | 0 | muchos (perdona) |
| Estrella | 42–46 | 4–5 | 1–2 | 0–1 | bastantes |
| Rayo | 38–42 | 5–7 | 2–3 | 1–2 | pocos |
| Fuego | 34–38 | 7+ | 3–5 | 3+ | casi ninguno |

### 6.4 Rediseño de las 16 pistas

| Copa | Pista | Tema | Gimmick principal | Peligros | Atajo (coste) | Dif. |
|---|---|---|---|---|---|---|
| Hoja | Pradera JP | hierba | Pista tutorial: enseña drift, rampas y cajas | vacas que cruzan lento (1) | campo de heno (hierba; necesita turbo) | ★ |
| Hoja | Playa Coco | arena | **Marea**: en la vuelta 2–3 el agua cubre la línea exterior (charcos → agua) | olas en la pasarela | muelle de madera (estrecho, sin muros) | ★ |
| Hoja | Club de Tenis JP | arcilla | Máquinas lanzapelotas: pelotas rodantes (reusa los sprites `BALL`) | pelotas | cruzar la pista por el hueco de la red | ★★ |
| Hoja | Bosque Encantado | hierba noche | Niebla + setas trampolín (salto con truco) | setas que rebotan de lado | tronco hueco (oscuro, curvo) | ★★ |
| Estrella | Valle Molino | hierba atardecer | **Aspas** de molino que barren la pista con ritmo | aspas, viento lateral | atravesar el granero (puertas que abren y cierran) | ★★ |
| Estrella | Dunas Doradas | dunas | **Tormenta de arena** en la vuelta 2 (vista + agarre); dunas-salto | remolinos que desvían | duna alta (truco obligatorio) | ★★ |
| Estrella | Bahía Atardecer | arena | **Día → noche** durante la carrera; el faro barre la pista | olas en la pasarela | pantalán (caída al agua) | ★★ |
| Estrella | Glaciar Polar | nieve | Hielo con poco agarre en las horquillas | pingüinos cruzando, grietas que se abren en la vuelta 3 | cueva de hielo (suelo hielo puro) | ★★★ |
| Rayo | Ciudad Neón | grid noche | **Tráfico**: autos por carriles fijos | autos, charcos con reflejos | callejón (estrecho, contenedores) | ★★★ |
| Rayo | Selva Tropical | hierba | **Lluvia** desde la vuelta 2; río con troncos | troncos flotando, barro | salto de liana (muelle o rampa) | ★★★ |
| Rayo | Pico Nevado | nieve día | **Nieve que cae**: la pista se estrecha cada vuelta | bolas de nieve rodantes (avalancha) | túnel de la cumbre | ★★★ |
| Rayo | Estadio Central | arcilla noche | **Compuertas** que alternan la ruta A/B cada vuelta | público que lanza objetos (cajas extra) | por las gradas (rampa) | ★★★ |
| Fuego | Cañón Rojo | dunas rojas | **Tren** en el paso a nivel, con semáforo | tren, rocas rodantes | túnel minero (vagonetas) | ★★★★ |
| Fuego | Autopista Láser | grid | Barreras láser intermitentes, muchos aceleradores, **sin muros** | caídas al vacío, láseres | rampa entre autopistas (salto largo) | ★★★★ |
| Fuego | Volcán Rugiente | roca | **Lava que avanza** cada vuelta; géiseres | géiseres, lava | puente de lava que **colapsa en la vuelta 3** | ★★★★ |
| Fuego | Cráter Ardiente | roca | Vuelo largo (rampa de planeo **legacy**) + lluvia de meteoritos telegrafiada | meteoritos, caídas | cráter interior (riesgo de caer) | ★★★★★ |

Durante la producción, las pistas legacy procedurales siguen jugables como copa **"Clásicas"** hasta que su versión autorada pase el validador. Así nunca se rompe lo que funciona.

### 6.5 Herramientas de pista (dev)
- **Visor/editor en modo debug** (`?debug=track` o F3) que dibuja:
  - spline, ancho, secciones coloreadas por tipo, muros, superficies;
  - racing line y líneas alternativas de la IA;
  - spawns, cajas, monedas, peligros con su reloj.

  Permite mover puntos de control y guardar el JSON (solo en dev).
- **Validador** (`bun run validate:tracks`, también en CI). Falla si:
  - la spline se cruza a sí misma (salvo puentes declarados con `h` distinta ≥ 20);
  - el semiancho es menor que el mínimo de la copa;
  - las métricas están fuera del rango de la copa;
  - un atajo tiene `needs` imposible;
  - **la IA difícil no completa 3 vueltas** en simulación headless con 3 semillas;
  - la vuelta media de la IA no cae en 50–60 s.

### 6.6 Arenas (para batalla)
Hacen falta 4 arenas pequeñas (cerradas, con muros y cajas). Están en **Could** del backlog y llegan con la fase de modos.

---

## 7. Inteligencia artificial

Tres capas desacopladas (`game-ai`) más una de objetos. Todo corre en `core`, es determinista y usa el RNG de la carrera.

### 7.1 Navegación
- **Racing line precalculada** por pista al construirla:
  - minimizar la curvatura con un offset lateral por muestra, respetando el ancho;
  - **líneas alternativas:** interior, exterior y una por atajo.
- **Perfil de velocidad:** `vMax(i) = sqrt(agarre × A / κ(i))` con un pase hacia atrás para frenar a tiempo según la deceleración disponible. Así la IA **frena antes** de la curva según curvatura y agarre (hielo, lluvia), en lugar de frenar tarde como hoy (`curve > 1.1 && speed > lim`).
- **Seguimiento:** pure-pursuit hacia un punto a `8 + v/18` muestras **(legacy)**, sobre la línea elegida + offset táctico.

### 7.2 Táctica (utility AI)
- Se evalúa a **5 Hz** (no cada tick), con histéresis +0,1 a la acción actual.
- Acciones:
  - `seguirLinea`, `adelantar(lado)`, `bloquear` (si hay rival detrás a < 60 u);
  - `tomarAtajo`, `esquivar(peligro|proyectil|trampa)`;
  - `buscarRebufo`, `recogerCaja`, `recogerMonedas`.
- Cada acción combina consideraciones normalizadas 0..1 con producto compensado (`ai-behavior-trees-utility-ai`). Ejemplos:
  - distancia al rival delante;
  - tiempo hasta la curva;
  - riesgo de la línea (borde con caída);
  - carga de rebufo;
  - objeto en mano;
  - posición;
  - personalidad.

### 7.3 Objetos
- Cada objeto aporta `aiScore(ctx)`.
- La IA usa el objeto si `score > umbral(personalidad, dificultad)`, tras su **tiempo de reacción**.
- Los defensivos se guardan (se sostienen detrás) mientras haya amenaza detrás.
- Se elimina el temporizador aleatorio `useAt` del legacy.

### 7.4 Personalidad (datos por personaje, `core/data/characters/*.json`)

| Personaje | Personalidad | Rasgos |
|---|---|---|
| Marco, Miguel | **Agresivo** | +ataque, bloquea, usa el objeto pronto, toma atajos de riesgo |
| Jesús, Mario | **Defensivo** | se guarda los escudos, línea limpia, pocos riesgos |
| Guaycaipuro, Andrés | **Oportunista** | busca rebufo, monedas y atajos; ataca cuando hay grupo compacto |
| Luis, JP | **Equilibrado** | pesos medios |

Una personalidad es solo un vector de pesos sobre las consideraciones; no tiene código propio.

### 7.5 Dificultad (`tunables/ai.json`)

| Parámetro | Fácil | Normal | Difícil |
|---|---|---|---|
| Precisión de línea (ruido lateral u) | ±18 | ±9 | ±3 |
| Reacción (ms) | 450 | 280 | 150 |
| Errores simulados (por vuelta) | 1,5 | 0,6 | 0,15 |
| Uso de atajos (prob.) | 0,1 | 0,4 | 0,8 |
| Nivel de drift máx. | 1 | 2 | 3 |
| Habilidad con objetos (umbral) | 0,75 | 0,55 | 0,4 |
| Rubber-band | ±6 % | ±5 % | ±3 % |

**Rubber-band suave:**
- Solo modifica la velocidad máxima de la IA en un rango acotado, según la distancia al **mejor humano**. No cambia la aceleración ni da objetos mejores.
- Rampa lineal entre 10 % y 30 % de vuelta de diferencia.
- Se desactiva en el último 15 % de la última vuelta.
- Nunca reposiciona karts.

### 7.6 Depuración
Overlay de IA (F4) que muestra:
- línea objetivo y punto de pure-pursuit;
- acción táctica actual y los **scores** de cada acción;
- `aiScore` del objeto en mano;
- multiplicador de rubber-band.

---

## 8. Personajes y clases de peso

Se mantienen los 8 personajes y sus stats **(legacy)**: `vel, ace, sue, man, pes, vue` (1–10). Las clases salen del peso:

| Clase | Rango `pes` | Personajes | Efecto en conducción | Efecto en choques |
|---|---|---|---|---|
| **Ligero** | < 5 | Marco (3), Andrés (4) | −15 % duración de giro tras golpe; ruedas pequeñas: ×1,1 de agarre fuera de pista | empujado +30 %; la Ráfaga lo mueve ×1,3 |
| **Medio** | 5–7,5 | Guaycaipuro (6), Jesús (7), Miguel (7,5) | — | — |
| **Pesado** | ≥ 8 | Luis (8,5), JP (8,5), Mario (8) | +10 % de inercia: tarda más en recuperar velocidad tras un golpe | empuja: el desplazamiento al ligero = `0,1 × KSIZE × Δpeso` **(legacy)**; la Ráfaga lo mueve ×0,7 |

Stats derivados **(legacy)**:
- `spd = 0,85 + vel × 0,03`
- `acl = 0,75 + ace × 0,05`
- `hnd = 0,8 + man × 0,04`
- `luck = sue`
- `w = pes`
- `fly = vue`

---

## 9. Progresión y guardado

- **Desbloqueos:**
  - Copa Hoja abierta desde el inicio. Cada copa siguiente se abre con podio en la anterior (en cualquier clase).
  - **150cc** se abre con oro en las 4 copas a 100cc. **Espejo** se abre con oro en las 4 copas a 150cc.
  - **Copa Clásicas** abierta siempre.
  - En LAN, el anfitrión puede activar "todo desbloqueado".
- **Récords locales:** mejor vuelta y mejor carrera por pista y clase, con su fantasma (replay).
- **Guardado** (`save-systems`):
  - JSON con `version` desde el día 1 y una cadena de migraciones `v → v+1`.
  - Escritura atómica (`.tmp` + rename, con `.bak`) en Electron (`userData`); `localStorage` en web.
  - Se guarda **datos**, nunca objetos.
  - Archivos separados: `settings.json` (incluye bindings), `progress.json`, `ghosts/<pista>-<clase>.replay`.
  - Validación al cargar; si falla, se usa `.bak`.

---

## 10. Input

- **Acciones, no teclas** (`input-systems`): `acelerar`, `frenar`, `girar` (eje −1..1), `derrapar` (= hop/truco), `objeto`, `objetoAtras` (mantener = sostener detrás), `mirarAtras`, `pausa`.
- **Teclado y mando** (Gamepad API) con zona muerta **radial** en el stick; perfil por defecto por tipo de mando. Los iconos del HUD cambian según el último dispositivo usado.
- **Remapeo** con detección de conflictos, "restaurar por defecto" y guardado en `settings.json`.
- **Buffer de entrada:** `derrapar` y `objeto` se recuerdan 0,1 s (para no perder pulsaciones entre ticks y frames).
- El paquete de red sigue siendo `{t, s, d, item, seq}`, con `s` analógico cuantizado a 8 bits.
- **Pantalla dividida local** (2–4 jugadores): fase opcional (ver `PLAN.md`). Es viable porque el render va en GPU (Three.js WebGPU).

## 11. Audio (resumen; detalle en `docs/ART_BIBLE.md` §8)

- Buses: `Master ← Música, SFX, Motores, Voces, UI`, controlados en dB.
- Música adaptativa por intensidad y última vuelta.
- Ducking en eventos grandes.
- Motores posicionales de los 3 rivales más cercanos.

## 12. Cámara (resumen; detalle en `docs/ART_BIBLE.md` §7)

- Seguimiento con suavizado exponencial independiente del framerate.
- Lookahead en drift; cámara de salto.
- Kick de FOV en turbos.
- Shake por *trauma* sobre un offset visual (nunca sobre el kart), con opción de reducirlo.
- Repetición final dirigida por eventos usando el replay.
