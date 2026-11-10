# Conquest

A Commander variant. Official ruleset (Google Doc):
https://docs.google.com/document/d/1LOh-zWLvt2CLSsSIsBCEURVNmyKGyznINwvJsXZymy4/edit.
Community: https://discord.gg/wH5F2QS. Last synced with the doc on 2026-11-08. When the ban list
changes, update `web/src/formats/conquest.ts` and the date here.

Conquest inherits the Commander rules, with these changes:

| # | Rule | Where it's enforced |
|---|---|---|
| 1 | Commander must be a legendary Creature, Planeswalker, Vehicle or Spacecraft card, or a DFC/flip card whose back face is one | Deck editor (`isCommanderEligible`) |
| 2 | 30 starting life in multiplayer, 25 in 1v1 | Game setup: **not built yet** (no upstream change needed; set via `RegisteredPlayer.setStartingLife`) |
| 3 | 12 commander damage (instead of 21) | Game engine: **needs an upstream hook** (see below) |
| 4 | At least 80 cards, singleton except basic lands | Deck editor (`validateConquest`, `maxCopies`) |
| 5 | Pregame scry: after mulligans and before pregame actions, each player who isn't first scries X, where X is the number of players before them in turn order (multiplayer only) | Game engine: **needs an upstream hook** (see below) |
| 6 | For deck construction, each hybrid symbol can count as any one of its halves, and the card's colors are ignored | Deck editor (`fitsIdentity`) |

**Card pool:** every tournament-legal paper card except the Reserved List, silver-bordered cards
and acorn-stamped cards. The bans are Conspiracies, ante, stickers/attractions, cards Wizards
removed, and the named ban list. We get this from Scryfall: a card is legal when its Vintage
legality is `legal` or `restricted`, it isn't `reserved`, and it isn't on the Conquest ban list.
There's also a "banned as commander" list and a "banned as companion" list (Lutri).

## Interpretations

The doc doesn't settle these points. Our reading, confirmed with the project owner on 2026-11-08:

- **Partners and Backgrounds.** Rule 1 says "a card designated as its commander", but Conquest
  "inherits the base Commander ruleset", and its ban list names partner commanders (Tymna,
  Thrasios). So we allow base Commander's pairs: two partner-style commanders (Partner, Friends
  forever, Doctor's companion), or a commander that has "Choose a Background" plus a Background.
- **"Any number of cards named…"** Card text overrides the singleton rule, as it does in Commander:
  Relentless Rats is unlimited and Seven Dwarves allows seven.
- **A commander's own color identity** is its full Scryfall color identity. The hybrid relaxation
  only applies to the other cards in the deck.
- **Reminder text** is ignored for color identity (CR 903.4). So is a hybrid symbol with a generic
  or colorless half ({2/W}).
- **The sideboard is checked** because it holds companions. The maybeboard isn't checked.

## Game engine work (when game sessions exist)

All of this can be done from `forge-web-server` with no upstream edits, using public Forge API:

- **Pregame scry (rule 5).** `RegisteredPlayer.addStartGameScript(...)` takes card-script lines.
  Forge runs them in `GameAction.startGame` right after mulligans and before opening-hand
  actions (`runStartGameScripts()`), which is exactly the window rule 5 names (between CR 103.4 and
  103.5). X depends on who goes first, and that's decided inside `startGame`. So we subscribe to
  the game's (synchronous) event bus. On `GameEventGameStarted`, which carries the first player
  and fires before the mulligans, we add `DB$ Scry | ScryNum$ <X>` for each player who isn't
  first. We have to clear those scripts again if the game restarts.
- **Commander damage 12 (rule 3).** Forge's own check (`Player.checkLoseCondition()`, 21) still runs.
  We add ours: on every `GameEventPlayerPriority` we check each player's `getCommanderDamage()`
  for a total of 12 or more, and call `loseConditionMet(GameLossReason.CommanderDamage, null)`.
  Forge fires that event for every priority pass, AI players included, right after it checks
  state-based actions (CR 117.3). So the loss lands at the same point a state-based action would.
  The only gap: triggers that go on the stack in that same check come before the loss. If that
  ever matters, fall back to a one-line `// WEB-HOOK` that reads the threshold from `GameRules`.
- **Starting life (rule 2).** `RegisteredPlayer` adds +20 for Commander. Session code sets 30 or 25
  explicitly after `forCommander(...)`.
- **Deck size.** Forge's `DeckFormat.Commander` expects exactly 100 cards. Conquest games skip
  Forge's deck conformance check and run these rules server-side, backed by Forge's card database.
