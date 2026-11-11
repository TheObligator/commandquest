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

`{t:"start", deck: {name, cards: [{name, quantity, board, set?, collectorNumber?}], tokens?}, name, opponents, freePlay?}` starts a Commander
game against 1–3 Forge AI seats, each playing a random Commander precon that ships with Forge
(`forge-gui/res/quest/commanderprecons`). `board` is `commander` or `main` (others are ignored).
Card names are Scryfall's; double-faced cards resolve by their front face. `set` and
`collectorNumber` (Scryfall's) pick the printing, so the card's set, and the tokens it makes, match
the one in your deck; Forge's default printing is used when it doesn't have that one. `tokens` is
the deck's token art, `{"<token identity>": "<Scryfall id>"}` (identity as in `web/src/tokens.ts`,
e.g. `goblin|R|1/1`); your tokens are tagged with it. If Forge doesn't know a
card, the answer is an `error` that lists them.

`freePlay` (default true) allows the things players do by hand at a paper table: `manual`,
`counter` and `payFree`. When it's false those are refused with a `notice`, and only the cards' own
effects change the game. Free play only ever acts for the browser's own seat, never for AI seats.

One game per user: starting another (or from another tab, which gets `{t:"replaced"}`) ends the
old one, and so does closing the socket. `MAX_GAMES` (default 4) caps games on the server.

## Server → browser

| `t` | Meaning |
|---|---|
| `state` | `view`: the game as you see it, in the client's `GameView` shape (`web/src/game/view.ts`), plus `gameOver` and `playable` (your cards you can cast, play or activate right now, not counting mana abilities; empty unless you have priority). `autoYieldsOff`: you've disabled all your auto-yields. `freePlay`: this game allows manual overrides. Stack items carry `text` and `targets` (`[{label, cardId?, playerId?}]`); abilities on the stack also carry your yield settings: `yieldKey`, `autoYield`, and for your own "you may" triggers `optional` and `decision` (`ASK` / `ACCEPT` / `DECLINE`). Sent whenever it changes. Hidden information is already removed (below). Tokens carry `tokenArt` (the Scryfall id from their owner's deck, when it has that kind of token), `tokenKey` (Forge's image key) and, when Forge knows the printing, `tokenSet` / `tokenNumber` (Scryfall's), for their art. |
| `prompt` | Forge is waiting for you: `message`, and two buttons `ok` / `cancel`, each `{label, enabled}` with Forge's labels ("OK", "Keep", "Mulligan", "End Turn"…). Answer with a button or by clicking a card or player. While you pay mana for a spell or ability, it also has `pay`: `{cost, card, cardId, kind, free}` (`cost` like `{2}{G}`, still unpaid; `kind` `spell`, `ability` or `effect`; `free` when this game has free play). Then `ok` is Forge's Auto-pay (enabled when your untapped sources can pay: it taps colorless and single-color sources such as basics before dual and any-color ones, and keeps the colors your hand needs), `cancel` stops the cast, clicking your mana sources pays by hand, and `payFree` pays nothing. |
| `waiting` | No prompt for you right now (others are deciding). |
| `ask` | A question that blocks the game: `{id, kind, title?, message, options?, selected?, min, max, card?}`. `kind` is `choose` (pick `min`–`max` of `options`, each `{label, cardId?, playerId?, card?}`), `info` (Forge reveals `options` to you: look, then answer with an empty `choice`), or `text` (`initial`, `numeric`). |
| `over` | The game ended. |
| `details` | Answer to `details` (below). Battlefield cards in `state` also carry `untapLock` (`next` or `never`) when kept from untapping by hand. |
| `notice` | `message`: why your last card click did nothing (e.g. "You can only play a land in a main phase. It's your Upkeep now: press OK to move on."). Forge itself ignores such clicks silently. |
| `actions` | Answer to `actions`: `{id, actions: [{ability, label, enabled}], reason?}`, everything the card can do in Forge's words, enabled if you can do it now, and `reason` when you can't do any of it. |
| `error` | `message` to show. |
| `pong` | Reply to `ping`. |

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
| `payFree` | Free play only: pay the rest of the mana cost you're paying now (a prompt with `pay`) with nothing, for a card whose "without paying its mana cost" isn't scripted right. Other costs (tapping, sacrificing, life) are still asked for. Logged "… without paying its mana cost (by hand)" (`engine/Payment`). If nothing's being paid, the answer is a `notice`. |
| `yieldsOff` `{off}` | Disable all your auto-yields (or turn them back on) without forgetting them. |
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
- Forge's start-of-game list of AI-deck cards it plays badly is turned off
  (`GameRules.setWarnAboutAICards(false)`): it would show you the AI's decklist.

`GameHubTest` plays a game over the socket and checks that opponents' hands are never sent.

## Not yet

- Ordering simultaneous triggers, dividing combat damage among blockers, and dividing an amount
  (e.g. "deal 5 damage divided as you choose"): Forge's default is used, with no question asked.
- Reconnecting to a game after the socket drops (the game ends instead).
- Multiplayer tables with other people (lobby).
