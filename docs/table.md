# Game table

The game screen. The board itself is `web/src/game/TableBoard.tsx`, shared by two pages:

- `#/game?deck=<id>` (`pages/LiveGame.tsx`): a live game against Forge AI on the game server
  (docs/game-protocol.md). Started from Play → Quick game. The left rail shows Forge's prompts and
  questions (`game/LiveRail.tsx`); clicking a card or a player's name sends it to Forge.
- `#/table` (`pages/Table.tsx`): a simulated game (`game/sim.ts`, `game/useSimGame.ts`) to try the
  layout, stops and decisions without a server. Use `?players=2|3|4` and `?start=new` (opening
  hands) or the default mid-game (turn 9, full boards).

```
 ┌ left rail ──┐ ┌──────────── seats ────────────┐ ┌ ☰ Menu ──────┐
 │ Log         │ │ Opp 1      Opp 2      Opp 3   │ │ Your turn T9 │
 │             │ │  (stack: a floating window)   │ │ Untap …      │
 │             │ │ You                           │ │ Save stops   │
 │ Decision    │ │                               │ │ Hold priority│
 │ Auto-pass   │ └ Hand (upright, from the left) ┘ └──────────────┘
```

## Layout

- **Left rail:** the log fills the top; at the bottom the decision the game wants (mulligan,
  bottoming cards, respond to the stack, your turn) and the auto-pass skips (docs/stops.md).
- **Right column:** the ☰ Menu button (live games), the phase strip with stops per step, split you /
  opponents (docs/stops.md), then the hold-priority toggle.
- **No toolbar in a live game:** while a game is on, the site's bars and the page's toolbar are
  hidden (`body.in-game`) so the table gets the whole window. Their controls are in the **Game
  menu**: the ☰ Menu button, right-clicking a board, or right-clicking anywhere on the table that
  has no menu of its own (not on cards or zones, so Concede is never one slip away from a card
  action). It has Layout ▸, Full screen, Hotkeys and settings (a new tab), Leave (the game is kept
  for 5 minutes), and Concede. Banners (reconnecting, game over) still show.
- **Hotkeys** are the player's own (Settings, `#/settings`; `web/src/game/hotkeys.ts`), and every
  button shows the key it's bound to. Defaults: Space pass priority / OK, X the second button
  (Cancel, Mulligan, End Turn), Shift hold priority (tapped on its own), C cast your commander, and
  E / B / M / R the auto-pass skips. Esc closes an enlarged board. They're saved to the account (Convex
  `settings`) and in the browser, so they also work signed out.
- **Seats** are always in turn order, starting from the player after you. Four layouts, chosen in
  the Game menu (the toolbar on `#/table`) and remembered per browser:
  - **Pod:** opponents in a row across the top, you below.
  - **Focus:** pod with your board much larger.
  - **Stacked:** one row per player: you, then each opponent. Short seats put the three
    battlefield groups side by side.
  - **Equal:** a quarter each, clockwise from you at bottom-left.
  - Any seat's ⤢ button enlarges it over the table (Esc to close).

## A seat

- Header: name, life, poison, commander damage taken (♛, in the attacking commander's color).
- Along the bottom-right (on the right in the stacked layout), the zones as card tiles, each with
  a label and count: library (a card back), top of graveyard, top of exile, the commander with its
  mana cost and tax (partners side by side; click one of yours to cast it), and how many cards are
  in hand. Click graveyard or exile to see every card in it.
- Battlefield in three rows that share the board's height: creatures, other permanents, lands. Each
  row is a grid of cells, one card or pile per cell, so cards never overlap (a tapped card turns
  sideways and shrinks to fit its cell). Every row has the columns that fit across the board, so
  lands line up under creatures. Cards nobody has moved are centered in their row; a new card joins
  a pile of identical cards (×N badge), or, in a row you've arranged, takes the free cell nearest
  the middle of the cards there (alternating sides, so the group stays centered). Rows side by side
  (stacked layout, short seats) fill from the left. Drag a card to any cell of any row: onto another
  card swaps them, and a card dragged from your hand lands in that cell once it's in play. Cards
  shrink to fit the seat. Arranging is only your view and never goes to the server; right-click
  the board to put everything back.
- **Double-click a board** (anywhere but a card or button) to enlarge it over the table; double-click
  it again, press Esc or click ✕ to go back. Same as ⤢ or "Enlarge … board" in its right-click menu.
- Your hand: upright cards from the left. Click it (live games) or drag it onto your board to play
  it. A double-click counts once. Hold **Shift** as you drop a permanent card to put it onto the
  battlefield without casting it (free play; same as the menu item below).
- **Playable cards** glow green (live games, while you have priority): your cards you can cast,
  play or activate now, in hand, on the battlefield, in the command zone, graveyard or exile.
- If a click does nothing, a message says why (not your turn, not a main phase, the stack isn't
  empty, you've already played a land…).
- **Hover a card** for a moment (`HOVER_ZOOM_MS` in `game/CardZoom.tsx`, 2 s) and a large image of
  it pops up beside the pointer. It goes away when you move off the card or click. Cards have no
  browser tooltip (their hints are `aria-label`s), so nothing covers the zoom. Cards on the board use
  Scryfall's "normal" image (488 px wide) at every size, so their text stays sharp on high-DPI screens.
- **Right-click** a card for its menu (live games; the browser's own right-click menu is off on the
  table):
  - **📖 Card details:** the card beside its text and what's different about it in this game: in
    live games Forge's text (rules text plus granted abilities and the like), current P/T (green
    when changed), counters, summoning sick, tapped, kept from untapping, owner, and for a
    commander how many times it's been cast from the command zone. Then the card's official
    rulings from Scryfall (`rulings` in `scryfall.ts`), open when there are four or fewer.
  - **Abilities:** everything Forge lets it do, greyed out when you can't do it now, with the
    reason.
  - **By hand** (manual overrides, like a paper table; outside the rules, logged "(by hand)", your
    own cards only, except counters, until-end-of-turn effects, goad and remove from combat, which go
    on any permanent). Common things are up front; the rest is in submenus so the menu stays short.
    - On the battlefield: Tap/Untap; counter rows with + and − (+1/+1, loyalty on planeswalkers,
      any already on it); **Add a counter ▸** (shield, stun, charge, lore, time, oil, finality,
      keyword counters…, and Other / several…); **⏳ Until end of turn ▸** (Power / toughness ±N
      and switch; Evasion and combat: can't be blocked, flying, menace, trample, first/double
      strike, vigilance, haste, lifelink, deathtouch, reach; Restrictions: can't block, can't
      attack, must be blocked, lure, prevent damage; Protection: indestructible, hexproof, shroud,
      protection from a color or everything; on someone else's permanent, Gain control, untapped
      with haste; creature groups only on creatures); **⚔ Put into combat attacking** (your
      creature, on your turn once attackers are declared: tapped and attacking the opponent you
      pick, unblocked if blockers are already declared); **Remove from combat** (any attacking or
      blocking creature); **More ▸** (turn face down/up, Transform for double-faced cards, Goad on
      someone else's creature, Phase out, 🔒 Doesn't untap next turn, 🔒 Never untaps by itself,
      Create a token copy); **Move to ▸** hand, graveyard, exile, **Exile face down ▸**, command zone,
      top or bottom of the library.
    - In hand: **⤵ Put onto the battlefield (don't cast)** (permanent cards only, for effects like
      "put a creature card from your hand onto the battlefield"), 👁 Reveal to ▸ Everyone (or one
      opponent), **Discard** (a real discard, so madness and "whenever you discard" work), **More ▸**
      Plot (exiled and plotted: Forge then lets you cast it free on a later turn as a sorcery),
      Foretell (as Forge does it: face down, foretold, only you may look; a card with foretell can
      then be cast for its foretell cost, any other card through Let me cast it), Suspend with 1–10
      time counters (it gains suspend if it hasn't got it, like Jhoira of the Ghitu, so the upkeep
      countdown and free cast happen), and **Move to ▸** (including Put onto the battlefield from other zones, permanents only).
    - **▶ Let me cast it ▸** on your card in exile or your graveyard (or a face-down exiled card
      you may look at): Paying its mana cost, Without paying its mana cost, or For another cost…
      (type it, e.g. {1}{U}). For cards a new effect lets you cast that Forge doesn't know about. It
      lasts until the card leaves that zone; then click the card to cast it as usual.
    - **Let an opponent search it** (library ▸ More): that player's table opens your library for
      them (the log says they searched it). They can right-click a card to exile it face down so
      only they may look at it, or face up; it goes to your exile. Closing the window ends the
      search and shuffles your library. They can then use Let me cast it on those cards.
    - **Exile face down ▸** (in Move to, from any zone but exile): Only you may look at it (foretell,
      hideaway), Only <opponent> may look at it, or Nobody. Forge keeps that permission while it's
      in exile; hovering it says who can see it. You can still right-click your own face-down
      exiled card to move it even when you may not look at it, and moving it to your hand or
      library doesn't name it in the log.
- **Right-click your library** (free play): Draw a card, 🔍 Search, Look at the top cards…,
  **Scry ▸** / **Surveil ▸** / **Mill ▸** 1 to 5 or X…, More ▸ (reveal the top card, exile the top
  card, draw / mill / exile several), 🔀 Shuffle. Scry and surveil open a window with the top cards
  (only you see them): keep each on top, in the order shown (left is the top card), or send it to
  the bottom (scry) or graveyard (surveil). The server does it as Forge's own scry or surveil, so
  "whenever you scry / surveil" triggers happen.
- **Menus and the hover card stay on screen:** a menu near an edge opens the other way, a submenu
  opens on whichever side has room and moves up to fit, and a menu taller than the window scrolls.
  The large hover card fits the window's height and moves as its image loads.
- **Right-click a zone tile or a board** to view the zone, enlarge the board,
  reset its layout, or pass priority.
- **The stack** is a floating window over the table (`game/StackWindow.tsx`), shown while
  something is on it. Drag it by its title bar and resize it from the corner; this browser
  remembers both. Each spell or ability is a tile, top first: name, art, kind, rules text and
  targets, numbered by stack position (1 resolves last). Click a tile, its ⋯ or right-click it to
  see the whole ability with its targets. In live games that also opens its settings: **Auto-yield**
  (pass on that ability of that card for the rest of the game), **Always Yes** / **Always No** for
  your own "you may" triggers, and **Disable auto-yields** (all of them, until turned back on).
- **Lines** run from each stack tile to the cards and players it targets, with its number at the
  end, and a dashed line to the permanent an ability comes from.
- The phase strip makes the current step taller, with a bigger label.
- Tokens show Scryfall art, in this order:
  1. **The deck's token list** (like Moxfield's): every token the deck's cards make, from Scryfall's
     `all_parts`, one entry per kind of token (name, colors and P/T: `tokenIdentity` in
     `web/src/tokens.ts`). The default printing is the commander's version if a commander makes it,
     else the newest card's. You can pick another printing per deck in the deck editor's Tokens
     section (Convex `decks.tokenArt`, only your picks are stored). Importing a deck brings its
     token printings in as picks: Moxfield's Tokens board, token cards on an Archidekt deck, or a
     `Tokens` section with set and number in a pasted list (`tokenPicks`). The deck's list goes to
     the game server at the start, and each player's tokens use their own deck's art.
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
