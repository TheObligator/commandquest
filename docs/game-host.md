# Game server host (the Mac)

Live games run on the Mac Studio. Everything else (the site, accounts, decks, stop presets) is on
Cloudflare and Convex, so when the Mac is off only live games stop.

```
browser: commandquest.app                     browser: staging.commandquest.app
   │  wss://game.commandquest.app/ws             │  wss://game-staging.commandquest.app/ws
   ▼                                             ▼
Cloudflare Tunnel ── one tunnel, outbound from the Mac, no open ports, home IP never exposed
   │  http://localhost:8091                      │  http://localhost:8090
   ▼                                             ▼
production server, built from `production`    staging server, built from `staging`
(launchd: com.commandquest.game-production)   (launchd: com.commandquest.game)
```

Two servers, so the public site always talks to the same code it was built from. Staging's server
follows `staging` and redeploys whenever `staging` moves. Production's follows `production` and only
changes when `production` is promoted. Each accepts only its own site's origin and its own Convex deployment's sign-ins.
An idle server takes about 450 MB of memory and no CPU.

| | `SITE=staging` (default) | `SITE=production` |
|---|---|---|
| Builds | `origin/staging` | `origin/production` |
| Port | 8090 | 8091 |
| Address | `game-staging.commandquest.app` | `game.commandquest.app` |
| Allowed origin | `https://staging.commandquest.app` | `https://commandquest.app` |
| Convex sign-ins | `robust-barracuda-45` | `impressive-manatee-540` |
| Folder | `~/.commandquest/game` | `~/.commandquest/game-production` |
| launchd jobs | `com.commandquest.game`, `.autodeploy` | `com.commandquest.game-production`, `.autodeploy-production` |
| Logs (`~/Library/Logs/`) | `commandquest-game.log`, `commandquest-autodeploy.log` | `commandquest-game-production.log`, `commandquest-autodeploy-production.log` |

The tunnel (`com.commandquest.tunnel`), its token and the replay secret are shared, and live in
`~/.commandquest/game`.

## The service

`forge-web-server/scripts/game-service.sh` (run from anywhere in the repo). Every command acts on the
staging server unless it's prefixed with `SITE=production`, e.g. `SITE=production forge-web-server/scripts/game-service.sh status`.

| Command | What it does |
|---|---|
| `deploy` | Fetches and checks out the site's branch (or `REF=<branch or sha>`) in the server's own worktree (`<folder>/src`), builds it with tests, installs the jar and (re)starts the server. Starts the tunnel if it isn't running, but never restarts it. A failed build leaves the running server alone. |
| `status` | The server's jobs and the tunnel, the commit running, and `/health` on localhost and through the tunnel |
| `logs` | Follows the server's log and `commandquest-tunnel.log` |
| `restart` | Restarts the server |
| `restart-tunnel` | Restarts the tunnel, which briefly drops both servers' games |
| `set-token` | Saves the tunnel token to `~/.commandquest/game/tunnel-token` (mode 600, never in the repo) |
| `auto-on` | Every 15 minutes, deploys the site's branch if it's newer than what's running and no game is in progress (see Updating) |
| `auto-off` | Stops the auto-deploy job |
| `uninstall` | Removes the server and its auto-deploy job, and the tunnel too if the other server isn't installed |

Deploying builds a commit, not this working tree, so switching branches here doesn't change what
players are on. It's separate from the dev service (`web/scripts/dev-service.sh`, port 8080).

Server settings (set by the script, per server, from the table above): `PORT`, `ALLOWED_ORIGINS`
(only that site can open a game socket or read `/health`), `CONVEX_ISSUERS`, and `GIT_SHA` (shown by
`/health`).

The site finds the server through `VITE_GAME_SERVER` in `web/.env.production` and
`web/.env.staging`. In dev it's unset, and Vite proxies `/ws` to the local dev server.

## One-time setup

1. **Tunnel** (Cloudflare dashboard, the account that has `commandquest.app`):
   Zero Trust → Networks → Tunnels → **Create a tunnel** → Cloudflared → name it `commandquest`.
   Copy the token from the install command it shows (the long string after `--token`). Don't run
   that install command: it would install a system-wide cloudflared service. Then, under
   **Public hostnames**, add `game-staging` . `commandquest.app` → Service `HTTP` `localhost:8090`
   and `game` . `commandquest.app` → Service `HTTP` `localhost:8091`.
   This tunnel is separate from the existing `pdf-extract` one.
2. On the Mac:
   ```sh
   forge-web-server/scripts/game-service.sh set-token    # paste the token, Ctrl-D
   forge-web-server/scripts/game-service.sh deploy && forge-web-server/scripts/game-service.sh auto-on
   SITE=production forge-web-server/scripts/game-service.sh deploy && SITE=production forge-web-server/scripts/game-service.sh auto-on
   ```
   `status` (and `SITE=production … status`) should then show `public: {"status":"ok",…}`.
3. **Keep the Mac available.** These are login services (no root), so they start when you log
   in. In System Settings, turn on automatic login for this user and, under Energy, "Prevent
   automatic sleeping when the display is off" and "Start up automatically after a power failure".

## Updating

Games in progress end when the server restarts, so it only restarts when nobody's playing.

With `auto-on`, a launchd job per server (`com.commandquest.autodeploy` and `…autodeploy-production`,
logs in `~/Library/Logs/`) checks every 15 minutes. When the server's branch (`origin/staging` or
`origin/production`) has moved past what's running and `/health` says `"games":0`, it deploys. So
promoting to `production` also updates the production server, as soon as nobody's playing on it. It checks again after the build,
before restarting, in case a game started meanwhile. A commit whose build or tests fail isn't
retried (it's recorded in `<folder>/failed`) until a newer one lands, and the running
server stays as it was. The job runs a copy of this script, `<folder>/game-service.sh`,
refreshed by each deploy.

This is how the nightly Forge sync (docs/deploy.md) reaches staging's games. To deploy right away instead,
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
