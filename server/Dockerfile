# BIG FIGHT room/relay server.
#
# Build context must be the REPO ROOT (so ../shared/protocol resolves).
# Deploy from the repo root with:
#   flyctl deploy --config server/fly.toml --dockerfile server/Dockerfile --app bigfight-online .
FROM oven/bun:1-slim

WORKDIR /app

# Preserve the server -> ../shared relative import layout.
COPY shared ./shared
COPY server ./server

ENV PORT=8080
EXPOSE 8080

CMD ["bun", "server/main.ts"]
