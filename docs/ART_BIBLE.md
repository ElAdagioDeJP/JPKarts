# JP Kart — Biblia de arte

> Dirección de arte y de presentación (render, partículas, cámara, HUD, audio, accesibilidad).
> Skills de referencia: `create-game-assets`, `shader-programming`, `camera-systems`, `game-feel`, `game-ui-ux`, `audio-design`, `performance-optimization`.
> Regla madre: **primero se aprueba una pista de referencia (vertical slice) y después se produce en familias.** Ningún asset es "final" hasta verlo a resolución nativa, en movimiento y sobre el fondo real.

---

## 1. Identidad

**Pixel art 16-bit con voxels**, como una consola de los 90 con un chip de terreno que no existió. Hoy el juego **no es Mode 7 plano**: es un raycaster *voxel-space* por columnas sobre un heightmap (`renderWorld` en el legacy), con sprites escalados con z-buffer. Esa identidad se conserva y se eleva.

| Se conserva | Se eleva |
|---|---|
| Terreno con relieve real, niebla con dithering Bayer 4×4 | Iluminación por pista (color grading), sombras de kart, post-proceso suave |
| Karts generados por voxels (`voxelKart` → 24 rotaciones) | 32 rotaciones + estados animados (giro, salto, golpe, celebración) |
| Outline oscuro único `#1a1026` (`OUT`), luz desde arriba-izquierda (`sph`) | Paleta limitada por bioma, reglas de sombreado escritas |
| Fuente Press Start 2P, textos en español | HUD rediseñado, legible a 2 m de distancia |
| Todo generado por código (sprites, sonido) | Se mantiene: assets como **datos/código**, no PNG sueltos, salvo excepciones aprobadas |

## 2. Resolución y escala

- **16:9 (aprobado e implementado).** Mundo a **640×360** y UI lógica a **426×240** (se mantiene el alto de 240 del legacy para conservar los layouts de los menús; el canvas de UI se dibuja a ×3 para texto nítido). Escalado *nearest*:
  - ×2 = 1280×720;
  - ×3 = 1920×1080 exacto.
- Hoy es 4:3 (mundo 640×480, UI 320×240). En monitores 16:9 deja bandas.
- En ventanas que no son múltiplo exacto: barras (letterbox) del color de la niebla de la pista, nunca escalado no entero.
- **Escala de sprites a distancia de cámara normal:**

| Elemento | Tamaño en pantalla |
|---|---|
| Kart propio | ~56 px de alto |
| Rival a 100 u | ≥ 24 px |
| Rival a 400 u | ≥ 12 px (**silueta legible mínima**) |
| Cajas, objetos y peligros | ≥ 10 px a 300 u |

## 3. Paleta y sombreado

- **Por bioma: máximo 32 colores**, más una **paleta compartida de 16** para karts, objetos, UI y efectos. La compartida nunca cambia entre pistas, así un objeto se reconoce igual en todas.
- Biomas (heredan los temas `th()` del legacy): `grass, sand, clay, dunes, snow, grid, rock`, más variantes (noche, atardecer). Cada bioma define:
  - rampa de suelo (3 tonos, ya existen en `ground`) y carretera/borde/línea;
  - cielo en 6 bandas, niebla, montañas en 2 capas, sol/estrellas/aurora;
  - **LUT de color grading** (la usa WebGL, §5);
  - colores de partículas (polvo, salpicadura).
- **Roles de color** (contraste de valor, no solo de matiz):
  - **Peligro** = rojo/naranja saturado + forma angulosa.
  - **Recompensa** (caja, moneda, acelerador) = amarillo/cian + forma redonda.
  - **Neutral/decorado** = desaturado y con valor medio.

  El fondo nunca usa los dos primeros roles a saturación alta.
- **Sombreado:**
  - Luz fija arriba-izquierda (`l = -(0.62·dx + 0.78·dy)`, como `sph`).
  - 4 tonos por material: luz ×1,3 · base · sombra ×0,78 · oscuro ×0,6.
  - Sin degradados suaves en sprites; el dithering solo se usa en niebla y cielo.
- **Outline:** 1 px `#1a1026` en todo lo que se mueve o se puede chocar. El decorado lejano lleva outline del color de sombra del bioma, para separar planos.

## 4. Karts y personajes

- Se mantiene la generación voxel (`voxelKart`, `renderVoxel`). Se suben a **32 rotaciones** (cache por personaje, generada al cargar o en build).
- Cada personaje conserva casco, kart, piel y accesorio **(legacy)**. Se añade un **color de identidad** usado en minimapa, nombre y estela (el color del casco).
- Estados animados (frames voxel con offset/rotación):

| Estado | Frames | Nota |
|---|---|---|
| Recto | 1 | |
| Giro | inclinación ±1/±2 | ya existe `lean` |
| Drift | inclinación 2 + chispas | |
| Salto/truco | giro de 360° en 8 frames | |
| Golpe | trompo de 8 frames | |
| Celebración | 4 frames | brazos arriba |
| Derrota | 2 frames | |

- **Squash & stretch** al aterrizar (×1,15 / ×0,87 durante 80 ms, ease-out). Lo hace el client a partir del evento `land`.
- **Sombra** en el suelo: elipse oscura con alfa 0,35. Se encoge con la altura, así se lee el salto.

## 5. Render: Three.js + WebGPU (decisión tomada)

**Decisión del dueño del proyecto (obligatoria): Three.js con `WebGPURenderer`.** Si el navegador no tiene WebGPU, Three cae solo a su backend WebGL2. Se fuerza con `?webgl`. El renderer Canvas 2D del legacy **no se porta**: Three ya da el respaldo y mantener dos renderers no compensa.

| | Legacy (Canvas 2D, CPU) | Actual (Three.js WebGPU) |
|---|---|---|
| Terreno | raycast *voxel-space* por columna en JS | **malla** de 512×512 vértices construida desde el heightmap de `core`; textura del suelo de 2048² generada igual que en el legacy (nearest al ampliar, mipmaps al reducir) |
| Cielo | filas con dithering + franja panorámica | dos cilindros centrados en la cámara (degradado con dithering y panorama de 360°) con el mismo mapeo ángulo→columna que el legacy |
| Proyección | horizonte desplazado (`hz`) | cámara nivelada con `setViewOffset`: el punto principal queda en `(RW/2, hz)`; misma focal `F = 320` |
| Sprites | `drawImage` + z-buffer manual | `THREE.Sprite` con `alphaTest` (decorado, cajas, proyectiles); charcos y alquitrán son planos en el suelo |
| Karts | 4 sprites por personaje | **malla voxel real** (el mismo modelo `voxelKart`), caras ocultas eliminadas, sombreado por cara horneado y contorno por casco invertido (`BackSide`) |
| Niebla | `fogMix` lineal 420→1000 | `THREE.Fog` lineal 420→1000 |
| HUD/menús | mismo canvas | canvas 2D superpuesto a 426×240 lógicos (×3) |

**Medido (Fase 1, PC de desarrollo, Edge):** WebGPU a 60 fps con render CPU de 3–7 ms. WebGL2 a 60 fps con render CPU de unos 10 ms.

**Paridad:** el aspecto no es idéntico píxel a píxel; se cambió a propósito por karts 3D y una malla. Lo que sí se conserva es lo jugable: la geometría, las alturas, la textura, las posiciones y los tamaños en pantalla. El tamaño del kart (`KART_VOXEL = 0,7`) se ajustó para que en pantalla mida lo mismo que el sprite del legacy visto desde `CAM_BACK`.

**Lo que hace WebGPU (Fase 5, con TSL/nodos de Three):** post-proceso, partículas GPU, agua animada, LUT por pista, pantalla dividida y sprites instanciados en un atlas, para pasar de ~650 draw calls de decorado a menos de 10.

### Cadena de post-proceso (orden)
1. Mundo a resolución interna (640×360) en FBO.
2. Sprites y partículas en el mismo FBO, con profundidad.
3. **LUT de grading** de la pista (día/noche interpola entre 2 LUTs).
4. **Bloom suave** (umbral alto, solo emisivos: neón, lava, chispas, faros); a media resolución.
5. Calor (distorsión UV con ruido) solo en las máscaras de lava/desierto.
6. Lluvia/nieve en espacio de pantalla y gotas en la "lente" (desactivable).
7. **Viñeta** leve.
8. Cuantización opcional a la paleta del bioma con dithering ordenado (modo "Puro 16-bit").
9. Escalado entero *nearest* a la ventana.

Todos los efectos se pueden desactivar en **Opciones › Gráficos** y tienen 3 niveles de calidad.

## 6. Efectos y partículas

Un **pool fijo** de partículas en el client: 1024 máx. con WebGPU y 512 con el respaldo WebGL2. Nunca se crean ni se liberan por frame (`performance-optimization`).

| Efecto | Disparador (evento de core) | Descripción |
|---|---|---|
| Polvo | off-road, arena | 2–3 px, color del suelo, sube y se desvanece |
| Chispas de drift | `driftLevel` | color del nivel (azul/naranja/morado), más densas al subir de nivel |
| Llama de turbo | `miniTurbo`, pads | 3 frames; su tamaño escala con la duración |
| Agua / charco | superficie | salpicadura + anillo; en la marea, espuma en el borde |
| Nieve | clima/superficie | copos en pantalla con parallax de 2 capas; huella detrás del kart |
| Lava | superficie/caída | brasas que suben y distorsión por calor |
| Golpe | `hit` | estrella `BOOM` **(legacy)** + 6 chispas + texto "¡Ay!" **(legacy)** |
| Moneda | `coin` | destello + número "+1" que sube con ease-out |
| Escudo | efecto activo | burbuja `RING` **(legacy)** que pulsa |
| Estela de rebufo | `slipstream` | líneas de viento cuya opacidad sigue a la carga |

- **Parallax del cielo:** 3–4 capas (cielo, montañas lejanas, montañas cercanas, nubes que se mueven), cada una ligada al yaw de la cámara con un factor distinto.
- **Decorado animado:** molinos que giran, palmeras que se mecen (2 frames), faro que barre, banderas, público del estadio. Son frames de sprite controlados por un reloj de render, no por la sim.

## 7. Cámara (`camera-systems`)

- **Seguimiento:** suavizado exponencial `t = 1 − exp(−rate·dt)` en posición y yaw. Rate de posición 10 y de yaw 8. Se actualiza **después** de interpolar el estado de la sim.
- **Lookahead en drift:** yaw extra hacia el lado del drift, hasta 0,12 rad, con ease-in de 0,3 s, para ver la salida de la curva.
- **Turbo:** el foco (`F`) baja 8 % (sensación de FOV más abierto) y vuelve con ease-out en 0,4 s.
- **Salto:** la cámara se separa (`CAM_BACK` +20 %) y sube; vuelve al aterrizar.
- **Mirar atrás:** corte seco (sin suavizado) mientras se mantenga la acción.
- **Shake:** modelo de *trauma* (`trauma²` × ruido suave) sobre un offset visual sumado al final. Nunca sobre el kart. Presets: pequeño 0,15, medio 0,4, grande 0,8. Opción "Reducir sacudida" (×0,3 o apagado).
- **Repetición final:** al terminar, la cámara de highlights recorre el replay y elige momentos por eventos (`hit`, `trick`, cambios de posición en la última vuelta), con cámaras orbitales fijas por sección.
- **Respawn/teletransporte:** corte intencional y se resetea el suavizado (sin latigazo).

## 8. Audio (`audio-design`)

Se mantiene la síntesis con WebAudio (sin archivos de audio), coherente con "todo es código". Se reorganiza así:

- **Buses:** `Master ← Música, SFX, Motores, Voces (gruñidos "¡Ay!"), UI`, con un limitador de seguridad en Master. Los sliders de opciones se convierten a dB (`linear → dB`).
- **Música adaptativa:**
  - Las canciones del legacy (`SONGS`) se parten en **stems**: bajo, batería, melodía, armonía.
  - Intensidad 0..1 a partir de la posición, de la distancia a rivales y del objeto en mano.
  - **Capas verticales**: entra la batería completa con intensidad > 0,5 y la melodía 2 en > 0,8.
  - **Última vuelta:** tempo ×1,06 (el legacy ya tiene `mul`) y una nota de aviso. Los cambios se cuantizan al compás.
- **Ducking:** la música baja 6 dB durante 0,4 s en eventos grandes (golpe propio, "¡Última vuelta!", meta).
- **Posicional:**
  - Motores de los **3 rivales más cercanos** (pool de 3 voces), con paneo estéreo por ángulo relativo a la cámara y atenuación por distancia.
  - Doppler leve en adelantamientos.
  - Los demás SFX de rivales tienen atenuación por distancia (como `groan` en el legacy).
- **Variación:** ±5 % de pitch aleatorio (con el RNG del **client**, no el de core) en golpes, monedas y pasos de superficie.
- **Avisos audibles:** cada peligro y cada `incoming` tiene un sonido propio y reconocible. Es parte del contrajuego.

## 9. HUD y menús (`game-ui-ux`)

- **HUD anclado a las esquinas** de la UI lógica (426×240), dentro de un margen seguro de 8 px:

| Zona | Contenido |
|---|---|
| Arriba-izquierda | Objeto en mano (ruleta animada) + objeto sostenido detrás |
| Arriba-derecha | Vuelta `2/3`, tiempo y mejor vuelta |
| Abajo-izquierda | **Minimapa** con rivales (punto con el color del personaje y contorno; el líder con corona; los humanos con flecha) |
| Abajo-derecha | **Posición grande** (`1º` a 32 px, con color por posición y animación *pop* al cambiar) + monedas |
| Centro-arriba | Banners (`¡Última vuelta!`, mensajes de peligro) |
| Bordes | **Indicador de objeto entrante**: flecha en el borde hacia donde viene, con icono y sonido; crece al acercarse |

- El HUD es **dirigido por eventos**: se suscribe a los eventos de core y no lee el estado cada frame.
- **Menús como pila de pantallas** (push/pop), siempre con un foco inicial, navegables con mando o teclado y compatibles con ratón.
- **Selección de personaje más rica:**
  - kart voxel girando;
  - retrato **(legacy `portrait`)**;
  - barras de stats con nombres en español;
  - clase de peso y personalidad de IA;
  - "Fuerte en… / flojo en…" **(legacy `autoDesc`)**.

  En LAN cada jugador ve su cursor de color y los personajes ya tomados.
- **Lobby LAN:** lista de salas descubiertas, jugadores con su estado "listo", y el anfitrión elige copa/pista/modo/clase/reglas de objetos.
- **Transiciones** con ease (slide + fade de 200 ms), nunca lineales.

## 10. Accesibilidad

- **Modo daltónico:**
  - Objetos y peligros llevan **forma + icono**, no solo color.
  - Paleta alternativa para los niveles de drift (azul/amarillo/blanco) y para los equipos (azul/naranja).
  - Prueba: deuteranopía y protanopía simuladas en la captura de referencia.
- **Reducir sacudida** y **reducir destellos**: los flashes de pantalla (`flash()`) se limitan a alfa 0,25 y a ≤ 3 por segundo.
- **Tamaño del HUD** a ×1 o ×1,5. Textos con contraste ≥ 4,5:1 sobre un panel con fondo.
- **Derrape:** se puede cambiar entre mantener y alternar (toggle).
- Opción **"Sin mancha de pantalla"** para los efectos que tapan la vista del local (barro, humo).

## 11. Proceso de producción de arte

1. **Brief del bioma**: paleta de 32, roles, decorado, peligros, LUT y referencia de partículas.
2. **Pieza objetivo**: una sección de la pista del vertical slice, con decorado completo, a resolución nativa. Se aprueba en juego, no en captura aislada.
3. **Familia**: el resto del bioma reutilizando paleta, luz y densidad de detalle.
4. **QA**:
   - hoja de contacto de sprites a 1× y 3×;
   - legibilidad a 400 u;
   - prueba daltónica;
   - medición de fps con 8 karts.
5. **Manifiesto** (`client/assets/manifest.json`): cada asset con id, origen (código/externo), licencia y estado (greybox / aprobado).
