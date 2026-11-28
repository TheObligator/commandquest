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

The precon decks players can copy into their account (`#/decks/precons`) come from Forge's
`forge-gui/res/quest/commanderprecons/` deck files (Commander only; Secret Lair decks get their own
tab), dated by `forge-gui/res/editions/`. `npm run precons` turns them into `web/public/precons.json`,
which is committed because CI checks out only `web/`. It also writes `web/public/precon-cards/`, one
small file per deck with the Scryfall data the deck view needs (card ids, types, mana costs), so
opening a deck doesn't wait on Scryfall. Only cards it hasn't seen before go to Scryfall, so reruns
are quick; the first full run takes about four minutes. After merging upstream Forge, run it and
commit the results (the nightly Forge sync does this); `npm test` fails locally while they're out of date.

### Scryfall requests and card data

Scryfall's API limits requests per IP address (2 per second for searches and card lookups, 10 for the
rest), so every tab on a device shares one schedule (`src/scryfallQueue.ts`, kept in localStorage and
updated under a Web Lock). A 429, or a request that can't get through at all (a block can look like a
network error), pauses every tab: 30 seconds, doubling with each failure in a row up to 4 minutes.

Most cards are looked up by name, and those don't go to the API at all. `scripts/carddata.ts` builds
`web/public/card-data.json` and `web/public/card-data/<tag>/` (not committed) from Scryfall's daily
oracle bulk data at every build, like the card-name list: one printing per card, in 4096 small files
split by a hash of the name (`src/carddata.ts`). The folder is named for its contents, so the files are
cached for good (`public/_headers`). Cards asked for by a particular printing (id, or set and number),
names the data doesn't have, and data over 8 days old still go to the API. If the download fails, the
site just uses the API. `npm run carddata` downloads it again by hand.

### The card search dropdown

Suggestions come from a list of every card name, searched in the browser, so typing makes no requests
and misspellings are found as you type. `scripts/cardnames.ts` builds the list
(`web/public/card-names.json`, not committed) from Scryfall's daily bulk data: names in EDHREC
popularity order, plus what the color identity rules need (including Conquest's hybrid rule and
Rulebreakers, so those rules run on the list unchanged). `vite.config.ts` runs it before every build,
and when the dev server starts; a list less than a day old is used as it is.

If Scryfall can't be reached, the build warns and uses the newest list it has: the last one that
downloaded, or the committed copy in `web/data/card-names.json`. On CI, the last one comes from GitHub's
build cache. `staging` deploys save it (`.github/workflows/web.yml`), and `production` deploys read it too. GitHub
drops it after 7 days without use, which is when the committed copy matters. The nightly Card names
workflow keeps both fresh (docs/deploy.md). `npm run cardnames` downloads a new list and updates the copy
by hand; do that and commit it whenever `CARD_NAMES_VERSION` goes up (`npm test` fails until you do).

`src/cardsearch.ts` is the matching, `src/cardsearch.worker.ts` runs it in a Web Worker, and
`src/localsearch.ts` is how the search box asks it. Scryfall is still asked when the list isn't loaded
and when nothing in it has the text as typed (a card newer than the last deploy). Pressing Enter, and
Scryfall syntax, search Scryfall as before. A Rulebreaker that asks about something the list doesn't
have (it keeps front-face types, power of 4 or more, mana value of 7 or more) needs it added in
`buildCardNames` and `cardAt`.

### Card categories (Group by → Category)

Grouped by category, each card shows once: under its own category (`DeckCard.category`, chosen from the
card's menu or imported from Archidekt), else the best automatic one, else its type. Lands stay under Land
unless given a category. Categories are separate from tags, which can be several per card.

Automatic categories come from Scryfall Tagger's oracle tags. `CATEGORY_RULES` in `src/cardCategories.ts`
says which tags make each category, most telling category first. `scripts/cardcategories.ts` applies the
rules to the `oracle_tags` bulk file (6 MB) and writes `web/public/card-categories.json` (300 KB, not
committed), run by `vite.config.ts` like the card names, with the same fallbacks: the last list, or the
committed copy in `web/data/card-categories.json`. It also falls back if Tagger drops a tag a rule
names: the build warns, and the rules need fixing. After changing the rules, run `npm run cardcategories`
and commit the copy. Unlike the card names, CI doesn't cache it: each build downloads it.

From Archidekt, a card's first category becomes its category and any others become tags. Card types and
boards ("Creature", "Maybeboard") aren't kept as categories.

The grouping is saved with each deck (`decks.groupBy`, set by `decks.setGroupBy`); the default is Type.

### The deck list

`web/src/pages/DeckList.tsx` shows decks as a table (`DeckTable.tsx`, the default) or as covers. The view, the
sort and whether folders are rows of their own are kept per browser (`cq.deckView` in localStorage). Sorting is
in `web/src/deckSort.ts`. A deck's colors (`web/src/useDeckColors.ts`) are its commanders' color identity, or
without a commander the colors of its main deck, looked up on Scryfall from the `colorCards` in `decks.list`.
The bracket in the table is set with `decks.setBracket`, which leaves `updatedAt` alone.

### Card lists and packages

A **card list** is a deck whose format is `cardlist` (`web/src/deckFormats.ts`): one list of any cards, with
no commander, size, color or legality checks. It's in the deck list and its folders, but games don't offer it.

A **package** (`web/convex/packages.ts`, the Packages tab of the Decks page) is a set of cards to add to decks.
It's private to its owner and is edited in the deck editor (`PackageEditor`), with one board. The deck
editor's Packages tab (`web/src/components/PackagesPane.tsx`) checks each package against the deck with
`planPackage` (`web/src/packages.ts`): the commanders' color identity, with Rulebreakers and Conquest's
hybrid rule, the format's legality, and what the deck has already. "+ Add" takes only what fits. Clicking
the package shows the rest too, which can be added with a warning. Cards are copied in, so editing a
package later doesn't change decks it was added to.

"+ Create" in the top bar makes a deck, package or list from any page (not during a game).

### Cards that don't work in games

The deck editor, its search results and the game start screen mark cards that won't work in a game
(`web/src/cardsupport.ts`), from `web/public/card-support.json`:

- **Not playable**: Forge has no script for the card. Anything Scryfall lists that isn't in
  `forge-gui/res/cardsfolder/` gets this, so a new card is marked from the day Scryfall adds it
  until a Forge merge brings its script in. Reprints match by name, so they're never marked. The
  game server refuses to start a game with one of these, so the start screen says so up front.
- **Known issue**: Forge has the card but it misbehaves. List it in `overrides/broken.json` with
  the reason, shown on hover, and the Forge issue it's waiting on. Remove the entry once Forge or
  an override fixes the card. After each Forge merge, `npm run broken:check` lists the entries
  whose issue has closed (it exits 1 if there are any). It uses GitHub's API, 60 requests an hour
  without a `GITHUB_TOKEN`.

`npm run cardsupport` builds the JSON from both. Like `precons.json`, it's committed, and
`npm test` fails locally while it's stale: after merging upstream Forge, or editing
`overrides/broken.json`, run it and commit the result.

A few names are spelled differently by Forge and Scryfall ("All Good Things . . ." and "All Good
Things..."). Matching ignores those differences, and the game start sends Forge's spelling.

### Loading, empty and failed

Anything a player waits on says so, and something on its way never looks like something that isn't
coming. What's loading moves; what has stopped stands still and says why, with a way to try again.
Use the shared pieces (`web/src/loading.css`) rather than plain "Loading…" text:

- A card's picture: `CardImg` (`web/src/components/CardImg.tsx`), or `CardWait` / `CardNone` while
  its data is looked up or when there's none. Grids that are loading: `CardSkeletons`, `DeckSkeletons`,
  only for as many as are surely coming, so nothing seems to vanish when they arrive. With no way to know how
  many, show a spinner, or what's known already (`KnownPrintings`).
- A page: `Loading`. One line: `Waiting`, or `ScryfallWaiting` when it's Scryfall (it says when
  Scryfall is slow, and counts down a 429's pause). A button that's working: `BusyLabel`. All in
  `web/src/components/Spinner.tsx`.
- A game button that asks the server for something: `PressButton`. `web/src/game/sending.ts` ignores
  further presses until the server answers, shows the spinner after 0.3 s, and lets the player press
  again after 10 s without an answer.

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
- **Caching.** Card data is cached in `localStorage` for 7 days, up to 1500 cards (Scryfall asks for at least 24h). Lookups already in flight are shared, so the editor and its token list don't fetch the same cards twice.
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
- Players pick a **username** in Settings (`users.setUsername`, rules in `src/username.ts`: 3–20
  letters, digits, spaces, `-` or `_`, unique regardless of case, not starting with "AI "). It's
  stored on Convex Auth's `users` table (extended in `convex/schema.ts`). `users.me` returns `name`
  as the username, else the sign-in provider's name, else "Player", and never the email address;
  that `name` is what games show. Signed-in players without one see a prompt linking to Settings.
- Staging (`robust-barracuda-45`) is a dev-type deployment. Its `SITE_URL` is currently the tailnet
  dev URL, and needs updating once staging has its own address.

### Sharing decks, Browse, comments and the changelog

- **Visibility** (`decks.visibility`, rules in `convex/model/sharing.ts`): `public` (in Decks → Browse and open by link),
  `unlisted` (link only) or `private` (owner only). New decks, copies and precons start public. Decks saved before sharing
  existed have no `visibility`, which means private. Each deck gets a random `shareKey` the first time it's shared, kept
  for good; its page is `#/d/<shareKey>` (`src/pages/SharedDeck.tsx`). Signed-out visitors can open it.
- Shared decks show the owner's **username** only (`decks.author`, refreshed on every save and on a username change), never
  their sign-in name. Saved ability settings, use-later and the folder aren't sent.
- **Search** (`sharing.search`, `src/pages/Browse.tsx`): only public decks. Public decks keep `searchText` (name + author)
  and `commanderText` for Convex search indexes, and one `deckCardIndex` row per card name (both faces of a two-faced card)
  for the card filter; `refreshSharing` keeps them in step after every write and clears them when a deck stops being
  public. A query starts from the most selective filter (cards, then commander, then name), reads at most 300 decks and
  filters the rest in `deckMatches`. Colors come from the owner's client (`colors` on save, worked out like the deck
  list's), so a deck never opened since sharing launched has none and won't match a color filter.
- **Likes** (`deckLikes`, counted on `decks.likes`; not your own deck), **favorites** (`deckFavorites`, Browse → My
  favorites), **views** (`deckViews`: once a day per signed-in player or per browser id, the owner's own don't count; rows
  are forgotten after two days by a cron) and **comments** (`deckComments`, `convex/social.ts`). Comments need a username,
  thread under the comment they answer (six levels deep, then they stay at that depth), and can be edited by their author
  and deleted by their author or the deck's owner. One with replies stays as "deleted". The owner can turn comments off in
  Share. Deleting a deck schedules `social.purgeDeck` for all of these; deleting an account takes back its likes.
- **Changelog** (`deckChanges`, `convex/changelog.ts`): recorded by the server on every save. Edits go into the deck's
  latest entry while they keep coming, and a new entry starts after an hour without one, so a sitting is one entry however
  often autosave runs, and it doesn't depend on the page saying when you leave. Card changes are net per sitting. The
  editor's History button and the shared page's History tab show it.
