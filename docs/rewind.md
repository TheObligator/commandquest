# Rewind

Players can take the game back to an earlier moment: undo a misclick, or replay a step or a whole
turn. Server: `forge-web-server/.../engine/Rewind.java`. Client: `web/src/game/RewindPanel.tsx`.
Protocol: `rewind` in [game-protocol.md](game-protocol.md).

## How far back (the host's setting)

The host picks a level on the setup screen (the `rewind` field of `start`):

| Level | Players may go back to |
|---|---|
| 0 | Nothing: rewinding is off |
| 1 | Just before your own last action, unless you've learned something since |
| 2 | Any moment of the current turn since you last learned something (see below) |
| 3 | Any moment of the current turn |
| 4 | Any moment of the previous turn too: a whole turn |

Each player's options are their own: what's allowed depends on who asks.

## Your last action

"Undo last action" goes back to just before the last thing *you* did this turn: cast a spell,
activated an ability, played a land, declared attackers or blockers, or changed something by hand.
A spell resolving isn't an action, so undoing a creature that has entered takes back casting it:
it's back in your hand (or command zone) and the lands that paid for it are untapped. Anything
other players did after it is taken back too (and they still have to agree). The game marks the
saved moment just before an action with who did it, from Forge's events (`GameEventSpellAbilityCast`
that isn't a trigger, `GameEventLandPlayed`, `GameEventAttackersDeclared` /
`GameEventBlockersDeclared`) and the log's "(by hand)" lines.

## New information

Levels 1 and 2 stop at the last moment you learned something hidden: no taking back a spell
because of the counterspell it drew, or a draw step because of the card you drew. You learn
something when a card you hadn't seen face up becomes visible to you: a card you draw, scry,
surveil or look at, a card from an opponent's hand that's cast, played or revealed, a face-down card
turned up. A card you'd already seen doesn't count, so an opponent casting a counterspell that was
in exile face up, or from a hand they'd revealed, or a card you put back on your library and
draw again, isn't new. Neither is a new token.

The server keeps, for each person at the table, every card id they've seen face up (Forge keeps
a card's id from zone to zone) and how many times they've learned something; each saved moment
notes those counts. It looks at every priority, at every zone change, whenever a question shows
them cards (scry, a reveal) and when they search their library. What you've learned is never
forgotten, even by a rewind. Levels 3 and 4 don't check it: everyone agreeing is enough.

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
