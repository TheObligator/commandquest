# Combos

A player records a combo by playing it once, then runs it again as often as they like. Server:
`forge-web-server/.../engine/Combos.java` (recording and running), `ComboState.java` (what one time
round changes). Client: `web/src/game/combos.ts`, `CombosPanel.tsx`. Protocol: `combo` in
[game-protocol.md](game-protocol.md). Combos are the player's own and last for the game.

## Recording

**Record** (left rail, when you have priority), play it once, **Stop** (when you have priority again).
A recording is what you did: cards and abilities clicked, players chosen, passes, payments, answers,
each with what the game was asking then (`Combos.asking`: the question's text without ids and numbers,
or, with priority, what's on the stack and whose). While recording, nothing is skipped or answered for
you (stops, yields, always yes / no, use later), and what isn't playing is refused: changes by hand,
paying nothing, auto-pass, asking to rewind. A rewind drops the recording.

When it ends where it started (same step, same stack, nothing more of yours tapped), it can be run many
times. Otherwise it runs once at a time. Its window shows the steps and what one time round changed.

## Running

Runs have to start where the recording did: the same stack, with priority. Each step waits until the
game asks what it asked then, and does the same through the same controls, so the rules apply, everyone
gets priority each time, and AI players respond as usual. Cards are found by id, else by name, zone and
controller (a token made anew each time). Answers are picked by what they say.

A run stops, and hands the game back as it is, when:

- you press Stop, concede, or lose the connection,
- the game asks you something else for 2 seconds (someone responded, a new trigger, a new choice),
- a card isn't there, or can't be used or paid for,
- someone asks to rewind.

It ignores your other moves meanwhile. Runs are capped at 1000 loops. Against AI a short loop takes about
10 ms; other people have to pass each time as always.

## Around a run

- **Rewind:** no moments are saved during a run, so it's one step back (`Rewind.hold`).
- **Replays:** a frame every 400 ms at most (`Recording.hold`).
- **Views:** everyone's are sent every 200 ms at most, and the runner's doesn't work out what's playable:
  that simulates payments with the mana pool the run is using.
