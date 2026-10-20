# JP Kart online server (docs/PLAN.md Fase 11, docs/DEPLOY.md).
#   docker build -t jpkart-online .
#   docker run -p 7777:7777 jpkart-online
# Stage 1 bundles packages/server/src/online.ts (core, track JSON, tunables and ws) into one file and builds the web client (vite).
FROM oven/bun:1.4 AS build
ARG VITE_BUILD_REF=dev
WORKDIR /src
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts
RUN bun build packages/server/src/online.ts --target=bun --outfile=/out/server.js
RUN VITE_BUILD_REF=${VITE_BUILD_REF} bun run build

# Stage 2: the bundle + the web client (served by the same process). Plain WebSocket on $PORT; TLS (wss://) is the reverse proxy's job (Traefik).
FROM oven/bun:1.4-slim
ARG VITE_BUILD_REF=dev
WORKDIR /app
COPY --from=build /out/server.js ./server.js
COPY --from=build /src/packages/client/dist ./web
ENV PORT=7777 WEB_DIR=/app/web NODE_ENV=production
ENV BUILD_REF=${VITE_BUILD_REF}
EXPOSE 7777
USER bun
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || 7777) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "server.js"]
