# Game server host (the Mac)

Live games run on the Mac Studio. Everything else (the site, accounts, decks, stop presets) is on
Cloudflare and Convex, so when the Mac is off only live games stop.

```
browser (commandquest.app / staging.commandquest.app)
   │  wss://game.commandquest.app/ws
   ▼
Cloudflare Tunnel ── outbound from the Mac, no open ports, home IP never exposed
   │  http://localhost:8090
   ▼
forge-web-server (launchd: com.commandquest.game) ── Forge rules engine and AI
```

One server, built from `web`, serves both the staging and production sites until live games work.
Splitting it into a staging and a production server comes later.

## The service

`forge-web-server/scripts/game-service.sh` (run from anywhere in the repo):

| Command | What it does |
|---|---|
| `deploy` | Fetches and checks out `origin/web` (or `REF=<branch or sha>`) in its own worktree (`~/.commandquest/game/src`), builds it with tests, installs the jar and (re)starts the services. A failed build leaves the running server alone. |
| `status` | Both services, the commit running, and `/health` on localhost and through the tunnel |
| `logs` | Follows `~/Library/Logs/commandquest-game.log` and `commandquest-tunnel.log` |
| `restart` | Restarts the server and tunnel |
| `set-token` | Saves the tunnel token to `~/.commandquest/game/tunnel-token` (mode 600, never in the repo) |
| `auto-on` | Every 15 minutes, deploys `origin/web` if it's newer than what's running and no game is in progress (see Updating) |
| `auto-off` | Stops the auto-deploy job |
| `uninstall` | Removes the services |

Deploying builds a commit, not this working tree, so switching branches here doesn't change what
players are on. It's separate from the dev service (`web/scripts/dev-service.sh`, port 8080).

Server settings (set by the script): `PORT=8090`,
`ALLOWED_ORIGINS=https://commandquest.app,https://staging.commandquest.app` (only those sites can
open a game socket or read `/health`), `GIT_SHA` (shown by `/health`).

The site finds the server through `VITE_GAME_SERVER` in `web/.env.production` and
`web/.env.staging`. In dev it's unset, and Vite proxies `/ws` to the local dev server.

## One-time setup

1. **Tunnel** (Cloudflare dashboard, the account that has `commandquest.app`):
   Zero Trust → Networks → Tunnels → **Create a tunnel** → Cloudflared → name it `commandquest`.
   Copy the token from the install command it shows (the long string after `--token`). Don't run
   that install command: it would install a system-wide cloudflared service. Then, under
   **Public hostnames**, add `game` . `commandquest.app` → Service `HTTP` `localhost:8090`.
   This tunnel is separate from the existing `pdf-extract` one.
2. On the Mac:
   ```sh
   forge-web-server/scripts/game-service.sh set-token    # paste the token, Ctrl-D
   forge-web-server/scripts/game-service.sh deploy
   ```
   `status` should then show `public: {"status":"ok",…}`.
3. **Keep the Mac available.** These are login services (no root), so they start when you log
   in. In System Settings, turn on automatic login for this user and, under Energy, "Prevent
   automatic sleeping when the display is off" and "Start up automatically after a power failure".

## Updating

Games in progress end when the server restarts, so it only restarts when nobody's playing.

With `game-service.sh auto-on`, a launchd job (`com.commandquest.autodeploy`, log
`~/Library/Logs/commandquest-autodeploy.log`) checks every 15 minutes. When `origin/web` has moved
past what's running and `/health` says `"games":0`, it deploys. It checks again after the build,
before restarting, in case a game started meanwhile. A commit whose build or tests fail isn't
retried (it's recorded in `~/.commandquest/game/failed`) until a newer one lands, and the running
server stays as it was. The job runs a copy of this script, `~/.commandquest/game/game-service.sh`,
refreshed by each deploy.

This is how the nightly Forge sync (docs/deploy.md) reaches games. To deploy right away instead,
run `game-service.sh deploy`, which doesn't wait for games to finish.

## The engine inside the server

`forge-web-server/src/main/java/forge/web/engine/`:

- `ForgeEngine` starts Forge once per process with no desktop GUI (`HeadlessGui`). It finds the card
  scripts in `forge-gui/res` (`FORGE_ASSETS` overrides), and loads them lazily: a name index at
  startup (about 5 s), each card parsed the first time a game uses it. Forge keeps its user files in
  `~/Library/Application Support/Forge`.
- `GameSession` runs one Commander game. Human seats use Forge's own human controller
  (`PlayerControllerHuman`, from upstream `forge-gui`), the same one desktop Forge and its network
  play use, so every rules prompt (targets, modes, blockers, mulligans…) is Forge's. Its prompts reach
  a seat through an `IRemote`. In production that's the player's WebSocket, and in the tests a
  scripted stand-in. Other seats are Forge AI.
- Human seats are created by `WebLobbyPlayer` with `WebPlayerController`, a small subclass of
  Forge's controller that plays the mulligan as Commander does: the first mulligan is free even
  1v1 (Forge only frees it with 3+ players or in Brawl), and cards go to the bottom once you keep,
  not straight after each mulligan (London mulligan, CR 103.5).
- `HeadlessGui` gives Forge the single UI thread it expects (`forge-ui`). Browser answers are applied
  on that thread.

`GameSessionTest` plays a real four-player Commander game (one scripted human, three AI) for
several turns, and `GameHubTest` does the same through the WebSocket, as a browser would.
The socket protocol is in docs/game-protocol.md.

Server settings for games: `CONVEX_ISSUERS` (whose sign-ins are accepted; defaults to staging and
production), `MAX_GAMES` (default 4), `REPLAY_SECRET_FILE` (set by `game-service.sh` to
`~/.commandquest/game/replay-secret`: replays are recorded and sent to Convex, docs/replays.md).
