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
   - *Domains:* `kart.tudominio.com`, puerto del contenedor `7777`, **HTTPS activado** (Let's Encrypt).
   - Traefik ya hace el upgrade a WebSocket; no hace falta configurar nada más.
   - *Health check:* el `HEALTHCHECK` de la imagen (o la ruta `/health`).
4. **Comprobar:** `bun tools/online-check.mjs wss://kart.tudominio.com`.
5. **En el juego:** Online → Servidor: `kart.tudominio.com` → *Crear sala nueva*. Comparte el código; los amigos eligen *Unirse con el código*.
   - Para una build web propia, la variable `VITE_ONLINE_SERVER` deja el servidor ya escrito.

## Notas

- **Versión y reglas.** El protocolo y los tunables se comprueban al conectar. Un cliente de otra versión recibe un mensaje en español y no entra. Hay que desplegar el servidor junto con cada versión del juego.
- **Latencia.** La predicción completa del mundo y la reconciliación (Fase 6) toleran bien hasta ~120 ms: el smoke test de red usa 80 ms y un 2 % de paquetes retrasados.
- **Pendiente (prueba humana).** Falta una carrera completa entre dos redes distintas contra el servidor desplegado. Es la condición de "Terminado" de la Fase 11.
