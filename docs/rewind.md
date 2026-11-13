# Rewind

Players can take the game back to an earlier moment: undo a misclick, or replay a step or a whole
turn. Server: `forge-web-server/.../engine/Rewind.java`. Client: `web/src/game/RewindPanel.tsx`.
Protocol: `rewind` in [game-protocol.md](game-protocol.md).

## How far back (the host's setting)

The host picks a level on the setup screen (the `rewind` field of `start`):

| Level | Players may go back to |
|---|---|
| 0 | Nothing: rewinding is off |
| 1 | Just before the last action |
| 2 | Any moment in the current step or phase (or the start of the previous one) |
| 3 | Any moment of the current turn |
| 4 | Any moment of the previous turn too: a whole turn |

## Changing attackers or blockers

Until combat damage, attackers can be declared again ("Change attackers", from the declare
attackers step on) and so can blockers ("Change blockers", in the declare blockers step), e.g. to
add a blocker you forgot. That's a rewind to the last moment before they were declared (the end of
the step before), so every player still has to agree. It's allowed whenever rewinding is on (level
1 or more), even when the host's level wouldn't otherwise reach that far back. After a rewind back
before damage, the choice is there again.

Declaring again starts from what was declared: once the declaration is asked again, the server
clicks the earlier attacks (or your earlier blocks) back in, so only the changes need making. A
creature's right-click menu offers the change directly: "Attack with X too" / "Stop attacking with
X" for your creatures on your turn, "Block with X too" / "Stop blocking with X" when you're
defending. Select several creatures (all in combat, or all out of it) for the same on all of them.
That rewinds the same way, with those creatures added (to the defender most of the others
attack, or to an attacker coming at you) or taken out, and the rest as declared.

Forge's snapshot can't see inside `Combat`'s lists of attackers and blockers (they're built
lazily), so each saved moment keeps its own copy and a rewind puts it back. Forge's own way of
taking a creature out of combat leaves stale pieces behind (empty bands, "last known" copies), so
the rewind empties those lists directly before adding the saved attacks and blocks back.

## The timeline

Every time a player is about to get priority and something changed since the last save, the
server saves the game with Forge's `GameMemento` (`forge-game/.../undo/`). It saves only what
changed, so a moment costs memory in proportion to what happened, not to the size of the game.
Each saved moment is an entry on the timeline, labelled with what happened right after it from the
game log ("Before: AI 1 cast Lightning Bolt"), grouped by turn and step in the rail. Moments
outside the host's level are dropped as the game goes on, and the history is capped at 800
moments or about 1/6 of the server's heap, whichever comes first.

A player leaving the game clears the timeline: Forge has already cleaned up after them, so no
rewind goes back past that.

## Asking, agreeing, rewinding

Any player still in the game can ask. Every other person in the game has to say yes, and AI seats
always agree. One request at a time. The asker can take it back. Any "no" cancels it. While the
others decide, the game carries on, and the requested moment is kept.

Once everyone agrees, the rewind happens at the next priority. If a person is sitting at their
priority prompt, that's at once: the server ends that prompt without an answer, and when Forge
asks again it puts the saved moment back in place. Forge then carries on from there as if that
earlier priority had just come round. If someone is in the middle of something else (choosing
blockers, targets, a discard), the rewind waits until they're done.

After a rewind:

- The game log is cut back to that moment, plus one line saying who asked for the rewind.
- Every player's auto-pass is cleared, so it doesn't skip straight past the moment again.
- The timeline after that moment is gone. There's no redo.
- Shuffles and other random results aren't replayed: doing it again shuffles again.
- Everyone remembers what they saw, e.g. a card that was drawn. That's why everyone has to agree.

## Forge's own undo

Forge's own undo (`UndoManager`, the "Undo" button) is for one person against the AI and is
switched off (`ForgeEngine` sets `UI_UNDO_MODE` to Off). `Rewind` takes its place without changing
any upstream code: it listens to the game's events (`GameEventPlayerPriority`) and uses Forge's
public memento API.

## See also

- [Replays](replays.md) of finished games.
