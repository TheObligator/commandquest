# Game table

The game screen (`web/src/pages/Table.tsx`, components in `web/src/game/`). Until game sessions
exist, `#/table` runs a simulated game (`game/sim.ts`, `game/useSimGame.ts`) in place of the Forge
server. Use `?players=2|3|4` and `?start=new` (opening hands) or the default mid-game (turn 9, full
boards).

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

- Header: name, life, commander damage taken (♛, in the attacking commander's color), cards in hand.
- Public zones, always visible: commander (with tax), top of graveyard, top of exile, library
  count. Click graveyard or exile to see every card in it.
- Battlefield in three rows: creatures, other permanents, lands. Identical cards pile up with a ×N
  badge. Cards shrink to fit the seat. Drag cards to another row or position to arrange a board;
  that's only your view and never goes to the server.
- Your hand: upright cards from the left. Drag one onto your board, or double-click it, to play it.

## Hidden information

Each player gets a **view** of the game (`viewFor` in `game/view.ts`) with hidden information
removed, so a browser never receives what its player can't see:

- Other players' hands and every library: counts only.
- Face-down cards (hideaway, Gonti, morph…): everyone sees that the card is there and who may look
  at it, plus public facts (tapped, counters, a face-down permanent is a 2/2). Only the players
  allowed to look see its name.

The server must do this redaction (Forge: `CardView.canBeShownTo`) before sending state. The
client-side `viewFor` exists for the simulation and defines the expected result
(`web/tests/view.test.ts`).
