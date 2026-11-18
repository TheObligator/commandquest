# Game protocol (browser ↔ game server)

One WebSocket, `wss://game.commandquest.app/ws` (in dev, `/ws` on the Vite server, proxied to the
local game server). Every message is a JSON object with a type in `t`. Server: `forge-web-server`
(`GameHub`, `engine/BrowserSeat`, `engine/ViewJson`). Client: `web/src/game/useLiveGame.ts`.

The server runs Forge's own human controller for your seat, so the prompts and questions are
Forge's, word for word. Forge AI plays the other seats.

## Signing in

| Browser sends | Server answers |
|---|---|
| `{t:"hello", token}`: the Convex Auth token (`useAuthToken()`) | `{t:"hello", game, autoPass?}`, or `{t:"error"}` and close code 4401 |

The server checks the token itself (`ConvexAuth`): RS256, issued by one of `CONVEX_ISSUERS` (default:
the staging and production Convex site URLs), audience `convex`, not expired, signed by a key from
`<issuer>/.well-known/jwks.json`. Everything except `ping` needs a signed-in socket.

## Reconnecting

A game belongs to its player, not to the socket. When the socket closes mid-game, the game waits
5 minutes for that player (Forge simply waits for their next answer), then ends. Signing in again
within that time resumes it: `hello` comes back with `game: true` (and `autoPass`, the last mode
set), followed by the current `state`, the `prompt` on screen if there is one, and an `ask` for
every question still open. Stops and yields are kept on the server.

Signing in from a second tab takes the game over the same way; the first tab gets `{t:"moved"}`
and stays out of it until the player brings it back (the client signs in again).

The browser pings every 10 seconds and treats 25 seconds of silence as a dropped connection, since
a sleeping laptop or a dead Wi-Fi link can leave a socket that never reports closing. Restarting
the game server still ends every game: they're only in its memory.

## Starting a game

`{t:"start", deck: {name, cards: [{name, quantity, board, set?, collectorNumber?}], tokens?}, name, opponents}` starts a Commander
game against 1–3 Forge AI seats, each playing a random Commander precon that ships with Forge
(`forge-gui/res/quest/commanderprecons`). `board` is `commander` or `main` (others are ignored).
Card names are Scryfall's; double-faced cards resolve by their front face. `set` and
`collectorNumber` (Scryfall's) pick the printing, so the card's set, and the tokens it makes, match
the one in your deck; Forge's default printing is used when it doesn't have that one. `tokens` is
the deck's token art, `{"<token identity>": "<Scryfall id>"}` (identity as in `web/src/tokens.ts`,
e.g. `goblin|R|1/1`); your tokens are tagged with it. If Forge doesn't know a
card, the answer is an `error` that lists them.

One game per user: starting another (or from another tab, which gets `{t:"replaced"}`) ends the
old one. Closing the socket doesn't (see Reconnecting). `MAX_GAMES` (default 4) caps games on the
server, counting games waiting for their player.

## Server → browser

| `t` | Meaning |
|---|---|
| `state` | `view`: the game as you see it, in the client's `GameView` shape (`web/src/game/view.ts`), plus `gameOver` and `playable` (your cards you can cast, play or activate right now, not counting mana abilities; empty unless you have priority) and `landDrop` (it's your turn and a land in your hand could still be played this turn, timing aside, so the browser can ask before you pass your turn with it unplayed). `autoYieldsOff`: you've disabled all your auto-yields. Stack items carry `text` and `targets` (`[{label, cardId?, playerId?}]`); abilities on the stack also carry your yield settings: `yieldKey`, `autoYield`, and for your own "you may" triggers `optional` and `decision` (`ASK` / `ACCEPT` / `DECLINE`). Sent whenever it changes. Hidden information is already removed (below). Tokens carry `tokenArt` (the Scryfall id from their owner's deck, when it has that kind of token), `tokenKey` (Forge's image key) and, when Forge knows the printing, `tokenSet` / `tokenNumber` (Scryfall's), for their art. |
| `prompt` | Forge is waiting for you: `message`, and two buttons `ok` / `cancel`, each `{label, enabled}` with Forge's labels ("OK", "Keep", "Mulligan", "End Turn"…). Answer with a button or by clicking a card or player. |
| `waiting` | No prompt for you right now (others are deciding). |
| `ask` | A question that blocks the game: `{id, kind, title?, message, options?, selected?, min, max, card?}`. `kind` is `choose` (pick `min`–`max` of `options`, each `{label, cardId?, playerId?, card?}`), `info` (Forge reveals `options` to you: look, then answer with an empty `choice`), `text` (`initial`, `numeric`), or `arrange`: sort `options` into `piles` (`[{label, ordered, min, max}]`, `max` -1 for no limit), starting from `start` (option indexes, one list per pile); answer with one list per pile, in order (for the library, top first). Scry (Top / Bottom of library) and surveil (Top of library / Graveyard) are one `arrange` each, and so are Forge's "put these in order" and "choose several" lists (one pile, or the chosen pile and "Not chosen"). An answer that misses a card, repeats one, or breaks a pile's count is ignored. The browser shows `arrange` questions, and `choose` / `info` ones about cards that aren't on the battlefield, in a window with the cards. |
| `over` | The game ended. |
| `details` | Answer to `details` (below). Battlefield cards in `state` also carry `untapLock` (`next` or `never`) when kept from untapping by hand. |
| `notice` | `message`: why your last card click did nothing (e.g. "You can only play a land in a main phase. It's your Upkeep now: press OK to move on."). Forge itself ignores such clicks silently. |
| `actions` | Answer to `actions`: `{id, actions: [{ability, label, enabled}], reason?}`, everything the card can do in Forge's words, enabled if you can do it now, and `reason` when you can't do any of it. |
| `error` | `message` to show. |
| `pong` | Reply to `ping`. |
| `moved` | Another tab of yours signed in and took this game. |

## Browser → server

| `t` | Meaning |
|---|---|
| `ok` / `cancel` | The prompt's buttons. OK passes priority. |
| `card` `{id}` | Click a card (play it, cast it, tap it for mana, choose it as a target or attacker…). Forge decides what the click means. |
| `actions` `{id}` | What can this card do? (its right-click menu). Answered with `actions`. |
| `ability` `{id, ability, label}` | Use that ability of the card (from `actions`): the same as clicking the card, but if Forge asks which ability, this one is picked (by id, else by `label`). |
| `yield` `{key, autoYield?, decision?}` | Auto-yield to an ability (by its stack item's `yieldKey`) and, for your optional trigger, `decision` `ACCEPT` / `DECLINE` / `ASK`. Per card, for this game (the server pins Forge's auto-decision mode to "Per Card (Each Game)": its "per install" mode would share choices across everyone on the server). |
| `manual` `{id, action, to?}` | Manual override on one of your own cards (on the battlefield: you control it; elsewhere: you own it), outside the rules, logged "(by hand)" (`engine/ManualActions`). `action`: `tap`, `untap`, `faceDown`, `faceUp`, `skipUntap` (doesn't untap during its next untap step), `neverUntap` (put back after every untap step), `untapNormally`, `tokenCopy` (Forge's CopyPermanent), `toBattlefield`, `toHand`, `toGraveyard`, `toExile`, `toCommand`, `toLibraryTop`, `toLibraryBottom`, or `reveal` to the player ids in `to`. Moving a card between hidden zones (hand, library) doesn't name it in the log. If it doesn't apply, the answer is a `notice`. |
| `details` `{id}` | Forge's text for the card as you may see it (`CardDetailUtil.composeCardText`: rules text plus what's changed, like granted abilities). Answered with `details` `{id, text, sick, owner, commanderCasts?}`. |
| `counter` `{id, type, delta}` | Manual override: put `delta` counters of `type` (Forge's counter name, e.g. `+1/+1`, `Loyalty`, `Charge`; letters, digits, `+ - /` and spaces, up to 24) on a permanent, or take them off when `delta` is negative (±99 at most). Outside the rules, on any permanent; the game log records it ("… (by hand)"). |
| `yieldsOff` `{off}` | Disable all your auto-yields (or turn them back on) without forgetting them. |
| `player` `{id}` | Click a player (targets, attacking a player). |
| `answer` `{id, choice, text?}` | Answer `ask` `id`: `choice` is a list of option indexes (empty for none/cancel), a list of them per pile for `arrange`, `text` for a `text` question. |
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
- Forge's start-of-game list of AI-deck cards it plays badly is turned off
  (`GameRules.setWarnAboutAICards(false)`): it would show you the AI's decklist.

`GameHubTest` plays a game over the socket and checks that opponents' hands are never sent.

## Not yet

- Dividing combat damage among blockers, and dividing an amount
  (e.g. "deal 5 damage divided as you choose"): Forge's default is used, with no question asked.
- Keeping games across a game server restart.
- Multiplayer tables with other people (lobby).
