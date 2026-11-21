# Multiplayer tables

People play together at a **table**. Someone creates one, invites friends with a link, everyone
picks a deck, and the host starts the game. Forge AI can take the seats nobody fills.

| Piece | Where |
|---|---|
| Tables, seats, invites, host handover | Convex: `web/convex/tables.ts`, rules in `web/convex/model/tables.ts` (unit-tested in `web/tests/tables.test.ts`) |
| The lobby page | `#/tables/<id>`: `web/src/pages/TableLobby.tsx` |
| Invite links | `#/join/<code>`: `web/src/pages/JoinTable.tsx` |
| The game | `#/game?table=<id>`: `web/src/pages/LiveGame.tsx` joins the table's game on the game server |
| Game server side | `GameHub` (`table` message), `TableRosters` (talks to Convex), tested by `TableGameTest` |

## How a table works

- **Creating.** Play → *Create a table* makes a table with you as host and seats you. Defaults: 4
  seats, Forge AI fills empty seats, free play on, rewind level 2. The host can change the name,
  seats (2–4), AI fill, free play and rewind until the game starts. Changing a game setting takes
  back everyone's "ready".
- **Inviting.** Only the host sees the invite link (`#/join/<code>`). Anyone signed in who opens it
  sits down while there's a free seat and no game on. Signed-out visitors sign in first and come
  back to the link. *New link* replaces the code, so the old link stops working. Codes are 10
  characters from an alphabet without look-alikes (no 0/O/1/I/L), about 50 bits, so they can't be
  guessed. Play → *Join a table* also takes a pasted link or code.
- **One table at a time.** Creating or joining a table leaves the one you were at.
- **The host** is whoever created the table. When the host leaves (or is dropped for being away),
  a **random** player still seated becomes host. The host can also hand the table over (*Make
  host*) and remove players (*Remove*). A removed player can't come back with the invite link.
  When the last player leaves, the table is deleted.
- **Presence.** The table page and the table's game page check in every 20 seconds
  (`tables.heartbeat`). Before a game starts, a player who hasn't checked in for 60 seconds has
  left (closed the tab); this is checked whenever someone checks in, joins or starts. An hourly
  cron (`convex/crons.ts`) deletes tables nobody has checked in to for 6 hours.
- **Starting.** Every player needs a deck, and everyone but the host has to say they're ready.
  Without AI fill the table needs two people. The deck picker checks decks the same way the
  quick game does. A deck that needs free play can't be readied at a table with free play off.

## Starting the game

```
host presses Start ──► tables.start: status "playing", a new game key (128 random bits)
everyone's lobby page ──► #/game?table=<id>
each browser ──► game server: {t:"table", key, deck}
game server ──► GET <issuer>/tables/roster?key=… (once per game)
             ◄── {players: [{user, name}], ai, freePlay, rewind}
all players in (or 60 s passed) ──► one Forge game, a human seat each, plus `ai` AI seats
game over ──► POST <issuer>/tables/ended?key=… ──► table back to "open", ready cleared
```

- The **game key** is the secret. Convex gives it only to players seated at the table
  (`tables.get`), so the roster endpoint needs no other authentication. The game server checks
  that the signed-in user is on the roster. A key stops working once the game ends.
- The game server waits **60 seconds** for everyone. Players already in see who they're waiting
  for (`tableWaiting`). Then the game starts with whoever came, and the others are told who
  didn't make it (`notice`). Their seats aren't filled.
- **Leaving mid-game.** A player whose socket closes has the usual 5 minutes to come back
  (docs/game-protocol.md, Reconnecting). After that they **concede** and the others play on.
  Forge only frees a waiting player's input when the whole game ends, so the server also stops
  whatever the game was waiting on them for. Once every human has lost or left, the game ends.
- Players who are out of the game stay in the seating with `lost: true`, shown as **Out**.
- If the game never gets going (the game server is down, or full), the host can take the table
  back to the lobby (*Back to the lobby*). The server also sends the table back when it can't
  start the game.

## Not yet

- Spectators, and joining a game that's already on.
- A seat for someone who didn't make it in time (it isn't given to an AI).
- Public table lists. Tables are invite-only.
