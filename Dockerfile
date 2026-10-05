# CAST — production image (Railway/Fly/VPS).
# Multi-stage: deps → build → runner (Next standalone output).

# ── deps ──
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# npm install вместо npm ci: lock генерируется на macOS и содержит
# платформенные optional-записи, которые npm ci на linux не переваривает
RUN npm install --no-audit --no-fund

# ── build ──
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── runner ──
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3100 \
    HOSTNAME=0.0.0.0

# non-root user
RUN addgroup -S cast && adduser -S cast -G cast

COPY --from=builder /app/public ./public
COPY --from=builder --chown=cast:cast /app/.next/standalone ./
COPY --from=builder --chown=cast:cast /app/.next/static ./.next/static

USER cast
EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s \
  CMD wget -qO- http://127.0.0.1:3100/api/health || exit 1

CMD ["node", "server.js"]
