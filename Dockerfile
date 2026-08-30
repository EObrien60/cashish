# cashish — the books, as a long-running service.
#
# The desktop app and this image are the same code; only the shell differs. Running it
# as a service is what lets Lunar pull the integration summary over HTTP instead of
# passing a file around.
#
# better-sqlite3 is a native module, so it is compiled in a builder stage against the
# same Node version the runtime uses, and only the built artefacts are carried forward.
FROM node:20-bookworm-slim AS deps
WORKDIR /app
# Toolchain for better-sqlite3; absent from the runtime image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Electron is a devDependency worth hundreds of megabytes and is meaningless in a
# container, so it is skipped explicitly. Everything else is needed: `next build` and
# `next start` both want the dev toolchain present.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci --no-audit --no-fund

FROM deps AS build
WORKDIR /app
COPY . .
# `prebuild` initialises a SQLite file because `next build` collects page data across
# parallel workers. That build-time database is scratch and never leaves this stage —
# the real one lives on a volume.
ENV DATABASE_URL=/tmp/build-scratch.db
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=/data/cashish.db
# next.config.mjs sets no `output: standalone`, so the server needs node_modules.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs
# Present so the MCP server and the export script can run in this image too.
COPY --from=build /app/src ./src
COPY --from=build /app/mcp ./mcp
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts

# The books live on a volume, owned by the unprivileged user the image runs as.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000

# The schema and seed run when the first connection opens, so an empty volume
# initialises itself. Nothing here writes to the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start"]
