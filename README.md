# JP Kart

Carreras de karts pixel art para jugar entre amigos: caóticas y justas. Se juega en el navegador, como `.exe` de Windows, en LAN, online con código de sala o en pantalla dividida.

- **Render:** Three.js con `WebGPURenderer`. Si no hay WebGPU usa WebGL2 automáticamente (`?webgl` lo fuerza). Terreno voxel, sprites y post-proceso TSL.
- **Simulación:** determinista a 60 Hz en `packages/core`: sin DOM, con RNG con semilla y matemáticas idénticas en Bun y V8. La misma semilla y los mismos inputs dan el mismo hash, y en eso se apoyan la red, los replays y los fantasmas.
- **Red:** servidor autoritativo. El cliente predice el mundo entero y reconcilia con cada snapshot.

## Qué tiene
- **16 pistas autoradas** en 4 copas (Hoja, Estrella, Rayo y Fuego), cada una con su gimmick:
  - marea, tren, vacas, molinos, géiseres, láseres y meteoritos;
  - lava que sube, nieve que estrecha la pista y compuertas que cierran el camino según la vuelta;
  - lluvia, niebla, tormenta de arena y paso del día a la noche.
  
  Las 16 pistas legacy siguen jugables como **Clásicas**. Hay además **4 arenas** de batalla.
- **26 objetos:** los legacy revisados más Turbo Bala, Turbo Triple, Triple Ciego, Bumerán, Imán, Cadena de Rayos, Bloque de Hielo, Cortina de Humo, Ráfaga, Muelle, Mina y Escudo Reflector. También **monedas**, que suben la velocidad punta.
- **Conducción:** drift de 3 niveles, turbo de salida, trucos en saltos, rebufo, muros con rebote, superficies (barro, charco, hielo y arena) y clases de peso.
- **Modos:** Torneo, Carrera libre, Contrarreloj con fantasma, Eliminación, Equipos, Batalla de globos y Captura de la bandera. Clases 100cc, 150cc y Espejo.
- **Progresión:** desbloqueos, récords y guardado versionado con migraciones y copia `.bak`.
- **Repetición final** con cámara que salta a los mejores momentos.
- **Multijugador:** LAN (descubrimiento automático en la app de escritorio), online con salas por código, y pantalla dividida de 2 a 4 jugadores con un mando por jugador o el teclado repartido.
- **IA por capas:** racing line, tácticas, un `aiScore` por objeto, personalidades y rubber band acotado.

## Cómo jugarlo
```bash
bun install
bun run dev            # navegador: http://localhost:5173
bun run desktop        # app de escritorio (Electron) en desarrollo
bun run dist:win       # .exe portable en apps/desktop/release/
bun run server         # servidor LAN headless (puerto 7777)
bun run server:online  # servidor online con salas por código (ver docs/DEPLOY.md)
```

**Controles:**
- Flechas o WASD para conducir, Shift para derrapar y hacer trucos, Espacio para usar el objeto, P para pausar y M para el sonido. Funciona con mando y todo se puede reasignar.
- En pantalla dividida, J1 usa las flechas, Shift derecho y `/`, y J2 usa WASD, Shift izquierdo y Q. El resto de jugadores usa mandos.

## Desarrollo
```bash
bun test                     # determinismo, replays, mecánicas, modos, guardado, red, online
bun run validate:tracks      # geometría y duración de las pistas (también en CI)
bun run bench                # presupuesto de 2 ms por tick de simulación
bun packages/core/tools/item-telemetry.ts   # balance de objetos por posición
```

```
packages/core     simulación pura: física, IA, objetos, efectos, entidades, modos, pistas, red (protocolo, predicción)
packages/client   render Three.js WebGPU, HUD, menús, audio, input, game feel
packages/server   servidor autoritativo (LAN y online)
apps/desktop      Electron: cliente + servidor embebido + descubrimiento LAN
tools/            pruebas en navegador con capturas (Playwright)
```

## Documentación
- [`docs/GDD.md`](docs/GDD.md): diseño del juego.
- [`docs/PLAN.md`](docs/PLAN.md): fases y estado.
- [`docs/ART_BIBLE.md`](docs/ART_BIBLE.md): arte, render, cámara, audio y accesibilidad.
- [`docs/MECHANICS_BACKLOG.md`](docs/MECHANICS_BACKLOG.md): las mecánicas y su estado.
- [`docs/DEPLOY.md`](docs/DEPLOY.md): servidor online con Docker, Hetzner y Dokploy.
- [`CLAUDE.md`](CLAUDE.md): reglas obligatorias de la arquitectura.
