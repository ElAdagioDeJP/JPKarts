# JP Kart — Servidor online

El servidor online (`packages/server/src/online.ts`) usa la misma `Room` autoritativa que el LAN. Añade lo siguiente:

- **Salas con código** de 5 caracteres, sin letras que se confundan (no hay I, O, 0 ni 1). Una sala vacía se cierra sola.
- **Límites:**
  - 200 salas por proceso y 8 jugadores por sala.
  - 150 mensajes por segundo por conexión (los inputs llegan a 60 Hz) y mensajes de 8 KB como máximo.
  - Se cierra la conexión que no saluda en 10 s.
- **Validación:** el servidor no confía en el cliente.
  - Un input empaquetado tiene que ser de 5 enteros en rango; si no, se descarta (un `NaN` rompería el determinismo).
  - Los nombres se limpian y los ajustes de la sala se validan.
- **`GET /health`** responde `ok N salas`, para el proxy y para el `HEALTHCHECK` de Docker.

- **Cliente web:** el mismo proceso sirve el juego (`vite build`, carpeta `WEB_DIR`, en la imagen `/app/web`) en `/`. Con un dominio `https` el cliente usa ese mismo dominio como servidor online, así que entrar a `https://kart.tudominio.com` y pulsar *Crear sala nueva* basta.
- **Final de carrera:** cuando el primer humano cruza la meta, los demás tienen `race.finishTimeout` (30 s) para terminar; los que no llegan quedan como «Sin meta». Tras los resultados, la siguiente carrera de la copa (o el regreso a la sala) arranca sola a los `race.nextRaceDelay` (10 s); Intro del anfitrión la adelanta. Quien termina antes pasa a modo espectador.
- **Salida sincronizada:** el servidor manda `start`, cada cliente construye la pista y responde `loaded`; la cuenta atrás (3-2-1) arranca para todos a la vez con `go`. Quien no cargue en `race.loadTimeout` (15 s) pasa a IA. Mientras tanto la pantalla dice «Esperando a los demás jugadores (2 / 3)».
- **Conexión caída:** el servidor hace ping cada 10 s (mantiene vivo el proxy y detecta sockets muertos). Si un jugador se cae a mitad de carrera, su kart sigue con IA `race.awayKeep` (120 s). El cliente avisa («Conexión perdida»), reintenta cada 2 s con el mismo perfil (`pid`) y, al volver, recupera su kart con un snapshot completo. Cada carrera lleva un `rid`: lo que llegue de otra carrera se ignora.
- **Objetos por posición:** el campo se divide en tres zonas (delante / medio / atrás) y cada objeto tiene un peso por zona en `items.json` → `zones`. Los básicos (Bocina, Caja Falsa, Goma) no salen en la zona de atrás; los fuertes solo atrás; el Intercambio Cuántico es el de menor peso. `bun packages/core/tools/item-odds.ts` imprime la tabla.
- **Perfil local:** primera vez = bienvenida + tutorial + nombre (se guarda en `jpkart.profile`, versionado, con `id` aleatorio). El nombre no es único: cualquiera puede usar el mismo. Se cambia en Opciones.
- **Velocidad:** los 8 pilotos tienen la misma (`vel: 8`, la de Miguel) en `core/data/characters.json`.

El TLS (`wss://`) lo pone el proxy inverso. El contenedor habla WebSocket plano en `$PORT` (por defecto 7777).

## Imagen Docker

```bash
docker build -t jpkart-online .
docker run -p 7777:7777 jpkart-online
bun tools/online-check.mjs ws://localhost:7777   # health, crear sala, unirse, código erróneo
```

La imagen se construye en dos etapas:
1. `bun build` empaqueta el servidor con el core, las pistas, los tunables y `ws` en un solo archivo de unos 260 KB.
2. La imagen final (`oven/bun:1.4-slim`) solo contiene ese archivo y se ejecuta con el usuario `bun`.

La CI construye la imagen y la prueba con `tools/online-check.mjs` en cada push (job `docker-online`).

## Despliegue en Hetzner con Dokploy

1. **Servidor:** un VPS de Hetzner (un CX22 sobra para decenas de salas: cada sala usa ~0,07 ms de CPU por tick).
   - Instalar Dokploy: `curl -sSL https://dokploy.com/install.sh | sh`.
2. **DNS:** un registro `A` (por ejemplo `kart.tudominio.com`) apuntando a la IP del VPS.
3. **Aplicación en Dokploy:**
   - Crear la aplicación, origen *Git* (este repositorio, rama `main`) y *Build Type* `Dockerfile` (ruta `./Dockerfile`).
   - *Environment:* `PORT=7777`.
   - *Domains:* `kart.tudominio.com`, puerto del contenedor **`7777`** (con otro puerto Traefik devuelve `404 page not found`), **HTTPS activado** (Let's Encrypt). Con una app de tipo *Compose*, el repositorio incluye `docker-compose.yml` (servicio `jpkart`).
   - Traefik ya hace el upgrade a WebSocket; no hace falta configurar nada más.
   - *Health check:* el `HEALTHCHECK` de la imagen (o la ruta `/health`).
4. **Comprobar:** `bun tools/online-check.mjs wss://kart.tudominio.com`.
5. **En el juego:** Online → Servidor: `kart.tudominio.com` → *Crear sala nueva*. Comparte el código; los amigos eligen *Unirse con el código*.
   - Para una build web propia, la variable `VITE_ONLINE_SERVER` deja el servidor ya escrito.

## Notas

- **Versión y reglas.** El protocolo y los tunables se comprueban al conectar. Un cliente de otra versión recibe un mensaje en español y no entra. Hay que desplegar el servidor junto con cada versión del juego.
- **Latencia.** La predicción completa del mundo y la reconciliación (Fase 6) toleran bien hasta ~120 ms: el smoke test de red usa 80 ms y un 2 % de paquetes retrasados.
- **Pendiente (prueba humana).** Falta una carrera completa entre dos redes distintas contra el servidor desplegado. Es la condición de "Terminado" de la Fase 11.
