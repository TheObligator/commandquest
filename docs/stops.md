# Phases sidebar and priority stops

The game screen has a vertical phase strip on the right. Every step is a tile split in two:

```
 ┌──────────┬──────────┐
 │  you     ❯ opponents│   left: stop on YOUR turn
 │      UPKEEP         │   right: stop on opponents' turns
 └──────────┴──────────┘
```

- **Left part:** a stop on your own turn. **Right part:** a stop on opponents' turns. Clicking it
  sets the step for every opponent at once (striped when only some opponents have it).
- **Per opponent:** with the "Per opponent" switch on, the right part splits into one slice per
  opponent, in turn order and in their seat colors, so each opponent has its own stops.
- The current step is outlined in the active player's color, with an arrow on their side.
- **Stops only affect an empty stack.** As on MTGO, you always get priority when something is on the
  stack or the game needs a decision from you (attackers, blockers, targets…). Untap and cleanup
  have no priority (CR 502.4, 514.3), so they can't hold stops.
- **Pass (Space)** passes priority once. Keys are the player's own (Settings); the defaults are given here.
- **Auto-pass** (left rail) skips ahead, ignoring your stops but still stopping when something goes
  on the stack (`autoPassStatus` in `phases.ts`):
  - **End of turn (E):** skip the rest of this turn; your stops apply again from the next turn.
  - **Before my turn (B):** skip until the end step of the player right before you.
  - **Action / end step (R):** skip until someone casts something, or this turn's end step.
- **Hold priority (Shift, under the phase strip):** off, casting a spell or activating an ability
  passes priority once it's on the stack, as on MTGO. On, you keep priority, so you can cast more
  or respond to your own spell before passing. In live games the browser does the pass: once your
  item is on top of the stack, it answers Forge's next priority prompt (OK + End Turn / Undo) with
  OK (`LiveGame.tsx`).
- **Presets.** Each account has a default preset (Convex `stops.get` / `stops.save` / `stops.reset`):
  one list for your turn, one per seat (`seats[0]` is the player after you in turn order, and so on),
  and a general opponents list (the stops all opponents share), used for any seat with no saved list.
  "Save stops" stores all three. A smaller game keeps the saved seats it doesn't have.

Defaults (`DEFAULT_PRESET` in `web/src/game/phases.ts`, used by the client and by Convex):

- **Your turn:** main 1, beginning of combat, declare blockers, main 2. Upkeep and draw are off:
  a trigger there (or anything else on the stack) still gives you priority, so they only matter
  for instant-speed plays with an empty stack.
- **Opponents' turns:** beginning of combat, declare attackers, declare blockers, end step. These
  are the usual windows to respond on someone else's turn.

Step ids are Forge's `PhaseType` constant names (`web/tests/phases.test.ts` checks them against
`PhaseType.java`).

## Status

- Built: the phase strip (`web/src/game/PhaseStrip.tsx`), the stop and auto-pass logic
  (`web/src/game/phases.ts`, `shouldStop`), the account presets in Convex (`web/convex/stops.ts`),
  and a simulated table at `#/table` to try it (see `docs/table.md`).
- To do with game sessions: the server's remote player controller has to auto-pass based on these
  stops, so a pass doesn't need a round trip to the browser. The client sends its stops
  when it joins and whenever they change. `shouldStop` defines the behavior the server must
  match.
