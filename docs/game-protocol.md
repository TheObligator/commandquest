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

`rewind` (0–4, default 0) is how far back players may ask to rewind ([rewind.md](rewind.md)): 0 off,
1 the last action, 2 this step, 3 this turn, 4 into the previous turn.

`freePlay` (default true) allows the things players do by hand at a paper table: `manual`,
`counter`, `payFree`, `library` and `libraryCards`. When it's false those are refused with a `notice`, and only the cards' own
effects change the game. Free play only ever acts for the browser's own seat, never for AI seats.

One game per user: starting another (or from another tab, which gets `{t:"replaced"}`) ends the
old one, and so does closing the socket. `MAX_GAMES` (default 4) caps games on the server.

## Server → browser

| `t` | Meaning |
|---|---|
| `state` | `view`: the game as you see it, in the client's `GameView` shape (`web/src/game/view.ts`), plus `gameOver` and `playable` (your cards you can cast, play or activate right now, not counting mana abilities; empty unless you have priority). `autoYieldsOff`: you've disabled all your auto-yields. `freePlay`: this game allows manual overrides. `rewind` (when the game allows it): `{level, options, pending?, note?, noteId?}`, `options` the timeline you may rewind to, newest first, each `{point, level, label, turn, phase, player, stepStart, kind}` (`kind` `timeline`, or `attackers` / `blockers` to declare them again until combat damage) (`label` like "Before: AI 1 cast Lightning Bolt"), `pending` a request waiting on players `{by, mine, label, approved, needsMe, waitingOn}`, `note` the last thing that happened to a request (its `noteId` changes each time). `autoPassing`: an auto-pass you started is still going (Forge ends it when it gets there or something needs you). `selection`: what Forge's current prompt lets you click, `{cards, players, stack, chosen, actionable, offer}` (ids; `offer`: the faces of offered cards from places the table doesn't show, like your library during a search, to list in the prompt). `revealed`: cards Forge is showing you right now (an opponent revealing their hand). Players carry `counters` (energy, experience, rad…) besides `poison`. Stack items carry `text` and `targets` (`[{label, cardId?, playerId?}]`); abilities on the stack also carry your yield settings: `yieldKey`, `autoYield`, and for your own "you may" triggers `optional` and `decision` (`ASK` / `ACCEPT` / `DECLINE`). Sent whenever it changes. Hidden information is already removed (below). Tokens carry `tokenArt` (the Scryfall id from their owner's deck, when it has that kind of token), `tokenKey` (Forge's image key) and, when Forge knows the printing, `tokenSet` / `tokenNumber` (Scryfall's), for their art. |
| `prompt` | Forge is waiting for you: `message`, and two buttons `ok` / `cancel`, each `{label, enabled}` with Forge's labels ("OK", "Keep", "Mulligan", "End Turn"…). Answer with a button or by clicking a card or player. Sent again with the new `message` when Forge sets a prompt's text after its buttons. While you pay mana for a spell or ability, it also has `pay`: `{cost, card, cardId, kind, free, sources}` (`cost` like `{2}{G}`, still unpaid; `kind` `spell`, `ability` or `effect`; `free` when this game has free play; `sources`: your untapped permanents that can pay). Then `ok` is Auto-pay (enabled when your untapped sources can pay). The server plans it (`engine/AutoPay`): among sources that just tap for one mana (no damage, sacrifice or life), the cheapest set, preferring sources that make fewer colors (basics before dual and any-color lands) and leaving creatures untapped, tapped through Forge's payment one by one. Costs it can't plan (hybrid, Phyrexian, floating mana, only sources with drawbacks) fall back to Forge's own auto-payment, `cancel` stops the cast, clicking your mana sources pays by hand, and `payFree` pays nothing. |
| `waiting` | No prompt for you right now (others are deciding). |
| `ask` | A question that blocks the game: `{id, kind, title?, message, options?, selected?, min, max, card?}`. `kind` is `choose` (pick `min`–`max` of `options`, each `{label, cardId?, playerId?, card?}`), `info` (Forge reveals `options` to you: look, then answer with an empty `choice`), `text` (`initial`, `numeric`), `order` (put `options` in order, `top` naming the first place; answer with `min`–`max` option indexes in order: cards for the top of your library, triggers, damage order, or `distribute` (divide `amount` among `options`, each at least 1 when `atLeastOne`; answer with one number per option). `arrange` (scry and the like: each of `options` to the top or the bottom of your library, as `toTop` / `toBottom` allow; answer with the indexes for the top, first = top, then -1, then the ones for the bottom, last = bottom). An answer that doesn't fit gets Forge's default. |
| `over` | The game ended. |
| `details` | Answer to `details` (below). Battlefield cards in `state` also carry `untapLock` (`next` or `never`) when kept from untapping by hand. |
| `notice` | `message`: why your last card click did nothing (e.g. "You can only play a land in a main phase. It's your Upkeep now: press OK to move on."). Forge itself ignores such clicks silently. |
| `actions` | Answer to `actions`: `{id, actions: [{ability, label, enabled}], reason?}`, everything the card can do in Forge's words, enabled if you can do it now, and `reason` when you can't do any of it. |
| `libraryCards` | Answer to `libraryCards`: `{top, cards}`, your library's cards top first (all of it when `top` is 0), shown face up to you only. |
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
| `library` `{action, n?, to?}` | Free play, your own library, logged "(by hand)": `draw`, `mill` (to the graveyard) or `exile` the top `n` cards (1–99, default 1, names logged for mill and exile), `revealTop` to the player ids in `to`, or `shuffle`. If it doesn't apply (an empty library), the answer is a `notice`. |
| `libraryCards` `{top, log?}` | Free play: list your library for you only (`top` 0: all of it, a search; else its top `top` cards). With `log`, the game log says you searched it or looked at the top cards; the client sends it when you open the list, and refreshes without it. Answered with `libraryCards`. Move a card out with `manual`, like any card you own. |
| `yieldsOff` `{off}` | Disable all your auto-yields (or turn them back on) without forgetting them. |
| `player` `{id}` | Click a player (targets, attacking a player). |
| `answer` `{id, choice, text?}` | Answer `ask` `id`: `choice` is a list of option indexes (empty for none/cancel), `text` for a `text` question. |
| `stops` `{stops: {"<player id>": ["UPKEEP", …]}}` | The steps on each player's turn where you want priority (Forge `PhaseType` names). Every other step is skipped. Sent at the start and on every change. |
| `autopass` `{mode}` | `END_OF_TURN`, `BEFORE_MY_TURN` (until the end step of the player before you), `ACTION_OR_END_STEP` (until this turn's end step), or `null` to cancel. Forge still stops when something needs you. |
| `concede` | Concede. |
| `rewind` `{action, point?, kind?}` | Rewinding ([rewind.md](rewind.md)): `ask` to go back to `point` of `kind` (one of the view's `rewind.options`; `kind` defaults to `timeline`), `yes` / `no` to answer someone else's request, `cancel` to take yours back, `change` `{card}` to put your creature in or out of this combat's attack or blocks (a rewind to redeclare, with the rest as declared). If it can't be done, the answer is a `notice`. |

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
