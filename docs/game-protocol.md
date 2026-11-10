# Game protocol (browser ↔ game server)

One WebSocket, `wss://game.commandquest.app/ws` (in dev, `/ws` on the Vite server, proxied to the
local game server). Every message is a JSON object with a type in `t`. Server: `forge-web-server`
(`GameHub`, `engine/BrowserSeat`, `engine/ViewJson`). Client: `web/src/game/useLiveGame.ts`.

The server runs Forge's own human controller for your seat, so the prompts and questions are
Forge's, word for word. Forge AI plays the other seats.

## Signing in

| Browser sends | Server answers |
|---|---|
| `{t:"hello", token}`: the Convex Auth token (`useAuthToken()`) | `{t:"hello"}`, or `{t:"error"}` and close code 4401 |

The server checks the token itself (`ConvexAuth`): RS256, issued by one of `CONVEX_ISSUERS` (default:
the staging and production Convex site URLs), audience `convex`, not expired, signed by a key from
`<issuer>/.well-known/jwks.json`. Everything except `ping` needs a signed-in socket.

## Starting a game

`{t:"start", deck: {name, cards: [{name, quantity, board}]}, name, opponents}` starts a Commander
game against 1–3 Forge AI seats, each playing a random Commander precon that ships with Forge
(`forge-gui/res/quest/commanderprecons`). `board` is `commander` or `main` (others are ignored).
Card names are Scryfall's; double-faced cards resolve by their front face. If Forge doesn't know a
card, the answer is an `error` that lists them.

One game per user: starting another (or from another tab, which gets `{t:"replaced"}`) ends the
old one, and so does closing the socket. `MAX_GAMES` (default 4) caps games on the server.

## Server → browser

| `t` | Meaning |
|---|---|
| `state` | `view`: the game as you see it, in the client's `GameView` shape (`web/src/game/view.ts`), plus `gameOver`. Sent whenever it changes. Hidden information is already removed (below). |
| `prompt` | Forge is waiting for you: `message`, and two buttons `ok` / `cancel`, each `{label, enabled}` with Forge's labels ("OK", "Keep", "Mulligan", "End Turn"…). Answer with a button or by clicking a card or player. |
| `waiting` | No prompt for you right now (others are deciding). |
| `ask` | A question that blocks the game: `{id, kind, title?, message, options?, selected?, min, max, card?}`. `kind` is `choose` (pick `min`–`max` of `options`, each `{label, cardId?, playerId?, card?}`) or `text` (`initial`, `numeric`). |
| `over` | The game ended. |
| `error` | `message` to show. |
| `pong` | Reply to `ping`. |

## Browser → server

| `t` | Meaning |
|---|---|
| `ok` / `cancel` | The prompt's buttons. OK passes priority. |
| `card` `{id}` | Click a card (play it, cast it, tap it for mana, choose it as a target or attacker…). Forge decides what the click means. |
| `player` `{id}` | Click a player (targets, attacking a player). |
| `answer` `{id, choice, text?}` | Answer `ask` `id`: `choice` is a list of option indexes (empty for none/cancel), `text` for a `text` question. |
| `stops` `{stops: {"<player id>": ["UPKEEP", …]}}` | The steps on each player's turn where you want priority (Forge `PhaseType` names). Every other step is skipped. Sent at the start and on every change. |
| `autopass` `{mode}` | `END_OF_TURN`, `BEFORE_MY_TURN` (until the end step of the player before you), `ACTION_OR_END_STEP` (until this turn's end step), or `null` to cancel. Forge still stops when something needs you. |
| `concede` | Concede. |

## Hidden information

The server builds each player's view from Forge's views and removes what that player may not see
(`ViewJson`, using Forge's `CardView.canBeShownTo` and `canFaceDownBeShownTo`):

- Other players' hands and every library: counts only (`handCount`, `libraryCount`).
- A face-down card: `hidden` and `faceDown`, plus public facts (tapped, counters, its 2/2), unless
  Forge lets you look at it.
- Question options that are cards you can't see say "Hidden card".

`GameHubTest` plays a game over the socket and checks that opponents' hands are never sent.

## Not yet

- Ordering simultaneous triggers, dividing combat damage among blockers, and dividing an amount
  (e.g. "deal 5 damage divided as you choose"): Forge's default is used, with no question asked.
- Reconnecting to a game after the socket drops (the game ends instead).
- Multiplayer tables with other people (lobby).
