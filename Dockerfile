FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY index.js ./

# Path to the Scrivener external sync folder, mounted as a volume
ENV WRITING_SYNC_DIR=/sync
# Path to the SQLite index database
ENV DB_PATH=/data/writing.db
# MCP SSE port (used by OpenClaw gateway)
ENV HTTP_PORT=3000

# node:sqlite is experimental in Node 22; stable in Node 23+
ENV NODE_OPTIONS=--experimental-sqlite

HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
