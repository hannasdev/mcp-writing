FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ca-certificates git openssh-client \
  && mkdir -p /sync /data \
  && chown -R node:node /app /sync /data \
  && git config --system --add safe.directory /sync

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --chown=node:node index.js ./
COPY --chown=node:node bin ./bin
COPY --chown=node:node src ./src
COPY --chown=node:node README.md CHANGELOG.md ./

# Path to the Scrivener external sync folder, mounted as a volume
ENV WRITING_SYNC_DIR=/sync
# Path to the SQLite index database
ENV DB_PATH=/data/writing.db
# MCP HTTP/SSE port
ENV HTTP_PORT=3000
# Docker runs the HTTP/SSE transport by default. The published CLI still
# defaults to stdio for desktop MCP clients.
ENV MCP_TRANSPORT=http

# node:sqlite is experimental in Node 22; stable in Node 23+
ENV NODE_OPTIONS=--experimental-sqlite

EXPOSE 3000
VOLUME ["/sync", "/data"]

USER node

HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=20s \
  CMD node -e "const port=process.env.HTTP_PORT||3000; fetch('http://127.0.0.1:'+port+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
