# Game table

The game screen. The board itself is `web/src/game/TableBoard.tsx`, shared by two pages:

- `#/game?deck=<id>` (`pages/LiveGame.tsx`): a live game against Forge AI on the game server
  (docs/game-protocol.md). Started from Play → Quick game. The left rail shows Forge's prompts and
  questions (`game/LiveRail.tsx`); clicking a card or a player's name sends it to Forge.
- `#/table` (`pages/Table.tsx`): a simulated game (`game/sim.ts`, `game/useSimGame.ts`) to try the
  layout, stops and decisions without a server. Use `?players=2|3|4` and `?start=new` (opening
  hands) or the default mid-game (turn 9, full boards).

```
 ┌ action rail ┐ ┌──────────── seats ────────────┐ ┌ phase strip ┐
 │ Decision    │ │ Opp 1      Opp 2      Opp 3   │ │ Your turn T9 │
 │ Auto-pass   │ │                               │ │ Untap        │
 │ Stack       │ │ You                           │ │ Upkeep …     │
 │ Card preview│ │                               │ │ Hold priority│
 │ Log         │ └ Hand (upright, from the left) ┘ └ Save stops   ┘
```

## Layout

- **Action rail (left):** the decision the game wants (mulligan, bottoming cards, respond to the
  stack, your turn), the auto-pass skips (docs/stops.md), the stack (top first, in the caster's
  seat color), the hovered card, and the log.
- **Phase strip (right):** stops per step, split you / opponents (docs/stops.md).
- **Seats** are always in turn order, starting from the player after you. Four layouts, chosen in
  the toolbar and remembered per browser:
  - **Pod:** opponents in a row across the top, you below.
  - **Focus:** pod with your board much larger.
  - **Stacked:** one row per player: you, then each opponent. Short seats put the three
    battlefield groups side by side.
  - **Equal:** a quarter each, clockwise from you at bottom-left.
  - Any seat's ⤢ button enlarges it over the table (Esc to close).

## A seat

- Header: name, life, poison, commander damage taken (♛, in the attacking commander's color).
- Along the bottom-left (on the left in the stacked layout), the zones as card tiles, each with a
  label and count: library (a card back), top of graveyard, top of exile, the commander (with its
  tax), and how many cards are in hand. Click graveyard or exile to see every card in it.
- Battlefield in three rows: creatures, other permanents, lands. Identical cards pile up with a ×N
  badge. Cards shrink to fit the seat. Drag cards to another row or position to arrange a board;
  that's only your view and never goes to the server.
- Your hand: upright cards from the left. Drag one onto your board, or double-click it, to play it.
- Tokens show Scryfall art, in this order:
  1. **The deck's token list** (like Moxfield's): every token the deck's cards make, from Scryfall's
     `all_parts`, one entry per kind of token (name, colors and P/T: `tokenIdentity` in
     `web/src/tokens.ts`). The default printing is the commander's version if a commander makes it,
     else the newest card's. You can pick another printing per deck in the deck editor's Tokens
     section (Convex `decks.tokenArt`, only your picks are stored). The deck's list goes to the game
     server at the start, and each player's tokens use their own deck's art.
  2. Otherwise (e.g. AI precons), the token from the set of the card that made it: Forge's token
     image key names the printing (10E's Goblin is Scryfall's t10e #4).
  3. Otherwise a search by name, colors and base P/T, newest printing first.

  Lookups are cached in the browser for 24 hours (`tokenArt` in `web/src/scryfall.ts`). Until the
  art loads, or if Scryfall has none, a styled tile with the name and type stands in.
- Big overlays sit over the printed boxes so they read at a glance: the mana cost on cards in hand,
  and P/T on creatures. On the battlefield P/T is the current value (counters and effects
  included), green when above what's printed and red when below.

## Hidden information

Each player gets a **view** of the game (`viewFor` in `game/view.ts`) with hidden information
removed, so a browser never receives what its player can't see:

- Other players' hands and every library: counts only.
- Face-down cards (hideaway, Gonti, morph…): everyone sees that the card is there and who may look
  at it, plus public facts (tapped, counters, a face-down permanent is a 2/2). Only the players
  allowed to look see its name.

In live games the server does this (`ViewJson`, using Forge's `CardView.canBeShownTo`), so a
browser never receives another player's hand. The client-side `viewFor` does it for the
simulation (`web/tests/view.test.ts`).
