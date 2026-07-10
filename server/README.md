# BIG FIGHT online server

Room / WebRTC-signaling / relay server for BIG FIGHT multiplayer, plus static
hosting for the built game client. One Bun file, no framework, no deps.

## Run locally

```sh
bun server/main.ts        # from the repo root (or `bun main.ts` from server/)
```

- Game (once a client build is staged): http://localhost:8080/
- Health: http://localhost:8080/healthz → `{ok, rooms, players, uptime}`
- WebSocket: ws://localhost:8080/ws

Port comes from `$PORT` (default 8080).

## Deploy (Fly.io, app `bigfight-online`)

The one-liner (builds the client, stages it, deploys):

```sh
node scripts/deploy-server.mjs
```

That helper does: `npm run build` → wipe `server/public/` → copy `dist/` →
`server/public/` → deploy. `--build-only` skips the flyctl step.

Manual deploy (must run from the **repo root** so the Docker build context
includes `shared/`):

```sh
flyctl deploy --config server/fly.toml --dockerfile server/Dockerfile --app bigfight-online .
```

### Client hosting

The server serves whatever sits in `server/public/` at `/`. That directory is
git-ignored (only `.gitkeep` is tracked) and is filled at deploy time by
copying the Vite `dist/` output. With no build staged, `/` shows a friendly
"server is up" page.

## Protocol (see `shared/protocol.ts` — the single source of truth)

One WebSocket per player at `/ws`:

- **Text frames** = JSON control messages discriminated on `t`.
  - Client→server: `hello` (first; protocol version + buildId + optional
    resume), `createRoom`, `joinRoom`, `leaveRoom`, `setPlayer` (own
    pick/ready/team/nickname), `setSettings` (host), `startMatch` (host),
    `backToLobby` (host), `matchEnd` (host), `rematchVote`, `signal`
    (opaque WebRTC SDP/ICE to a playerId), `ping`, `reportPings`.
  - Server→client: `welcome` (playerId + resumeToken), `room` (FULL snapshot
    on every change), `joinError`, `upgradeRequired`, `countdown`,
    `countdownCancelled`, `matchStart` (matchId/seed/stage/players),
    `signal`, `roomClosed`, `pong`.
- **Binary frames** = relay: `[u8 slot|0x80, u8 channel(0=game,1=control),
  ...payload]`. Sender addresses a TARGET slot; the server rewrites byte0 to
  the SENDER's slot and forwards blindly — the WebRTC fallback path.

Room flow: `lobby` (all ready, ≥2 → 3s countdown, cancellable) → `charSelect`
(all picked + ready → auto-start) → `match` → `results` (all connected
rematch-vote → back to `charSelect` with picks kept; host `backToLobby`).
Rooms use 4-letter codes (no vowels/lookalikes). Join only in `lobby`; the
room pins the creator's `buildId` (mismatch → `versionMismatch`). Host leaving
closes the room. Disconnects hold the slot 30s (whole match during `match`)
for `hello.resume` reconnects. Co-op level gate: `maxLevelAllowed` = host's
levelsBeaten + 1. Server keepalive-pings every 20s (2 misses → close); empty
rooms GC after 5 min, absolute room lifetime 6h.
