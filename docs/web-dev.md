# Web client: local development

## Prerequisites

- JDK 17 (newer JDKs may work, but upstream Forge targets 17) and Maven 3.8.1+
- Node.js 20+ and npm

On macOS with Homebrew: `brew install openjdk@17 maven`, then
`export JAVA_HOME=/opt/homebrew/opt/openjdk@17` (Homebrew's `maven` otherwise runs on its own,
newer `openjdk`).

## Server (`forge-web-server/`)

Run these from the repository root:

```sh
mvn -f forge-web-server/reactor.xml package            # builds forge-core, forge-game, forge-ai, forge-gui and the server, and runs the tests
java -jar forge-web-server/target/forge-web-server-*-all.jar
```

The server only runs live games. Accounts, decks and stop presets live in Convex (below), so the
site keeps working while this server is down. It listens on port 8080 by default.

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `WEB_DIST` | unset | Serve the built frontend (`web/dist`) from this directory, so one process serves everything |
| `ALLOWED_ORIGINS` | unset (any) | Comma-separated site origins allowed to open `/ws` and read `/health`. Set in production (docs/game-host.md) |
| `GIT_SHA` | unset | Commit reported by `/health` |

Endpoints:

- `GET  /health` returns `{"status":"ok","version":"<GIT_SHA>"}`
- `WS   /ws` echoes every text message back (placeholder for the game protocol)

`reactor.xml` is an aggregator pom that lives in our module. It lets us build the upstream modules
we depend on together with our server, without editing upstream's root `pom.xml`. That keeps
upstream merges conflict-free.

## Frontend (`web/`)

```sh
cd web
npm install
npm run dev        # http://localhost:5173
```

The Vite dev server proxies `/health` and `/ws` to `http://localhost:8080`. Set `FORGE_SERVER` to
point it somewhere else. `npm run dev` talks to the staging Convex deployment
(`web/.env.development`). `npm run build` type-checks the code and writes a static bundle for
production to `web/dist/` (`npm run build:staging` for staging). `npm test` runs the unit tests in `web/tests/` with Node's built-in test runner
(Node 23.6+ runs the TypeScript directly, so there's no test dependency).

The frontend is React + TypeScript. `src/app/` holds the shell (hash router, layout, sign-in
gate), `src/pages/` holds one component per page, and `src/game/` holds the stops logic and
sidebar. Data comes from Convex through `useQuery` / `useMutation` (`convex/_generated/api`). Card
search, card data and images come straight from the [Scryfall API](https://scryfall.com/docs/api)
in the browser (`src/scryfall.ts` keeps requests under Scryfall's rate limit). Decklist text
parsing and export live in `src/decklist.ts`, and format rules in `src/formats/`. These modules have
no React or DOM imports, so `npm test` covers them directly.

## Opening the dev client from another machine (Tailscale)

Both servers listen on loopback only. To reach the client from another device on your tailnet,
publish the Vite port with `tailscale serve`. It's visible only to your tailnet (unlike `funnel`),
and it gives you HTTPS with a real certificate:

```sh
tailscale serve --bg 5173        # on the machine running `npm run dev`
tailscale serve status           # shows the URL, e.g. https://<machine>.<tailnet>.ts.net/
tailscale serve reset            # stop serving
```

On macOS the CLI is `/Applications/Tailscale.app/Contents/MacOS/Tailscale` unless you've added it
to your PATH. Then open the `https://….ts.net/` URL on the other device. The page switches to
`wss://` automatically, and the WebSocket and hot reload both go through the same URL. Only
port 5173 needs serving; Vite forwards `/ws` and `/health` to the Java server on that machine.

`vite.config.ts` binds to `127.0.0.1` (because `tailscale serve` forwards to IPv4 loopback) and
accepts `*.ts.net` host names via `allowedHosts`.

## Always-on dev mode (auto rebuild + restart)

`npm run dev:all` (in `web/`) runs Vite and the Java server together. When anything under
`forge-web-server/src`, its poms, or the upstream `forge-core`/`forge-game`/`forge-ai`/`forge-gui` sources
changes, it rebuilds the server (about 10s, tests skipped) and restarts it. If a build fails, the
previous server keeps running and the errors go to the log. Vite hot-reloads the frontend by itself,
and the page reconnects its WebSocket after a server restart.

To run it in the background at every login on macOS, and share it on the tailnet:

```sh
web/scripts/dev-service.sh install     # launchd agent + `tailscale serve --bg 5173`
web/scripts/dev-service.sh status      # running? + tailnet URL
web/scripts/dev-service.sh logs        # follow ~/Library/Logs/commandquest-dev.log
web/scripts/dev-service.sh restart     # after editing dev-all.mjs or vite.config.ts
web/scripts/dev-service.sh uninstall   # remove the service and stop sharing
```

The service builds whatever is checked out in this working tree, so switching branches redeploys.
It doesn't run tests. Run `mvn -f forge-web-server/reactor.xml package` before calling work done.

## Scryfall: rules we follow

All card art, card text and symbols shown in the client come from Scryfall at runtime. We never
commit card images. Scryfall's terms (https://scryfall.com/docs/api) apply, and breaking them can get
the app blocked:

- **Rate limits.** `/cards/search`, `/cards/named`, `/cards/random` and `/cards/collection` allow 2
  requests per second, and the rest of the API 10. `src/scryfall.ts` runs every API call through one
  queue that waits the right gap. On an HTTP 429 it pauses all calls for 30 seconds. Don't call
  `api.scryfall.com` anywhere else, and that includes `?format=image` URLs in `<img>` tags.
  Images and symbols come from `cards.scryfall.io` / `svgs.scryfall.io`, which have no rate limit.
- **Headers.** Browser code keeps the browser's own User-Agent and sends `Accept`. Server-side code
  must send an accurate User-Agent such as `CommandQuest/<version>`.
- **Caching.** Card data is cached in `localStorage` for 24 hours (Scryfall asks for at least 24h).
  To look up large numbers of cards (e.g. every card in a 4-player game), use Scryfall's daily
  bulk data files on the server rather than the API.
- **Images.** Never crop, cover or clip the artist name or copyright on a card image. Never distort,
  blur, recolor or watermark one. Wherever an `art_crop` is shown, the artist and copyright must be
  shown in the same view (see the deck tiles' "Art by …" caption).
- **Attribution.** Don't imply Scryfall endorses us. Card data must stay free to access (no
  paywall). The footer carries the Wizards of the Coast Fan Content Policy notice.

## Formats

Format-specific rules live in `web/src/formats/`, with one doc per format in `docs/formats/`. Right now that is only [Conquest](formats/conquest.md).

## Convex (accounts, decks, stop presets)

Everything players touch outside a live game lives in Convex, so sign-in and decks keep working
while the Mac is down. The functions are in `web/convex/`. The pure logic behind them is in
`web/convex/model/` and covered by `npm test`.

| Deployment | Name | Used by |
|---|---|---|
| Local | anonymous, on `127.0.0.1:3210` | `npm run convex:local` (no Convex account needed; writes `web/.env.local`) |
| Staging | `robust-barracuda-45` | `npm run build:staging` (`web/.env.staging`), the staging site |
| Production | `impressive-manatee-540` | `npm run build` (`web/.env.production`), the public site |

- `npm run convex:local` runs a local backend, pushes the schema and functions on every save, and
  type-checks them. `npx convex run <module>:<function> '<json args>'` calls a function. Add
  `--identity '{"subject":"<users _id>|x"}'` to call it as a signed-in user.
- Deploying to staging and production needs that deployment's deploy key (`CONVEX_DEPLOY_KEY`). It's
  kept out of the repo: a GitHub Actions secret, or a one-off `npx convex deploy` run by hand.
- Deployment environment variables (set with `npx convex env set`, never committed):
  `AUTH_RESEND_KEY` and `AUTH_EMAIL_FROM` (magic-link email via Resend, sent from `signin@commandquest.app`; the domain is verified in Resend), `AUTH_GOOGLE_ID/SECRET`,
  `AUTH_DISCORD_ID/SECRET`, `SITE_URL` (where sign-in links send people back to), `JWT_PRIVATE_KEY`
  and `JWKS` (Convex Auth's signing keys, generated with `jose`), and `MOXFIELD_USER_AGENT` (optional).
- Sign-in sessions last 10 years (`convex/auth.ts`). Nothing on the site needs re-authentication.
- Staging (`robust-barracuda-45`) is a dev-type deployment. Its `SITE_URL` is currently the tailnet
  dev URL, and needs updating once staging has its own address.
