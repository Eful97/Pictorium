FROM node:22-bookworm AS source
WORKDIR /src
ARG SOURCE_REPO=https://github.com/Eful97/Pictorium.git
ARG SOURCE_REF=master
COPY . .
RUN if [ ! -f package.json ]; then \
      apt-get update -o Acquire::Check-Valid-Until=false && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/* && \
      git clone --depth 1 --branch "$SOURCE_REF" "$SOURCE_REPO" /tmp/pictorium && \
      cp -a /tmp/pictorium/. .; \
    fi && test -f package.json

FROM node:22-bookworm AS deps
WORKDIR /app
COPY --from=source /src/package.json /src/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm AS builder
WORKDIR /app
COPY --from=source /src/package.json /src/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY --from=source /src ./
RUN npm run build

FROM node:22-bookworm AS runner
WORKDIR /app
LABEL org.opencontainers.image.title="Pictorium"
LABEL org.opencontainers.image.description="Dynamic cinematic poster generator for Stremio and media centers"
LABEL org.opencontainers.image.source="https://github.com/Eful97/Pictorium"
LABEL org.opencontainers.image.authors="Eful97"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
# Cap memoria JS configurabile per piattaforma: default 384MB (Koyeb tier 512MB).
# Chi ha più RAM (es. HF Spaces 16GB) può alzarlo via build-arg o env di piattaforma.
ARG NODE_MAX_OLD_SPACE=384
ENV NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE}"
ENV SHARP_CONCURRENCY=2
ENV SHARP_CACHE_MEMORY_MB=64
ENV PICTORIUM_DATA_DIR=/data
ENV POSTERIUM_DATA_DIR=/data

# In node:22-bookworm l'utente 'node' ha già uid 1000 / gid 1000,
# che coincide esattamente con l'owner dello storage HF Spaces (persistenza distribuita).
# Testo completo AGPL-3.0 a bordo immagine (anche senza .git nel context).
COPY --from=source /src/LICENSE ./LICENSE
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder /app/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data && chown -R node:node /data

# Esegui il server come utente non-root (principio del minimo privilegio).
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 8080) + '/api/health?probe=1').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
