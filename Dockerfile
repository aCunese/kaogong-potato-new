# ==============================================================================
# 考公工作台 · 生产 Dockerfile (Node.js 24 LTS, Multi-Stage Build)
# ==============================================================================

# ---- Stage 1: Build Frontend Assets ----
FROM node:24-bookworm-slim AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

# ---- Stage 2: Minimal Production Runtime ----
FROM node:24-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

# Install compilation toolchain for native SQLite/Argon2 addon build, then strip tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

# Strip build tools to keep image clean and secure
RUN apt-get purge -y --auto-remove python3 make g++ && \
    rm -rf /var/lib/apt/lists/* /root/.npm

# Copy compiled frontend and server source
COPY --from=builder /app/dist ./dist
COPY server/ ./server
COPY src/ ./src
COPY tsconfig.json ./
COPY tsconfig.server.json ./
RUN mkdir -p /app/release/apk /app/scripts
COPY release/apk/ ./release/apk/
COPY scripts/backup.sh scripts/restore.sh ./scripts/

# Setup data directory permissions for non-root node user
RUN mkdir -p /app/data/attachments /app/data/backups && \
    chown -R node:node /app

USER node

EXPOSE 3000

# Health check using Node.js built-in fetch (zero binary dependencies)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "--import", "tsx", "server/index.ts"]
