# Replays

Finished games can be watched again: the whole table, every hand face up, moment by moment.
Server: `forge-web-server/.../engine/Recording.java` (records) and `ReplayUploads.java` (sends).
Convex: `web/convex/replays.ts`, the `/replays` route in `http.ts`, rules in `model/replays.ts`.
Site: `#/replays` (`pages/Replays.tsx`) and `#/replay?id=…` (`pages/ReplayViewer.tsx`, reading
files with `game/replay.ts`).

## What's kept

Each player who took part keeps the game:

- **Recent games**: the last 5, automatically. A new game replaces the oldest.
- **Saved games**: up to 5 more, chosen with Save. They're never replaced. To save a sixth, delete
  one first.

A replay file is shared by everyone who played in that game, and deleted once nobody keeps it.
Games shorter than 2 turns aren't kept.

## Recording

The game server records a frame each time a player is about to get priority after something
changed (the same moments [rewind](rewind.md) saves), plus one at the end. A frame is the table as
`ViewJson` builds it with `seeAll` (every card face up, every hand shown: replays are only watched
after the game), without the log.

The file is gzipped JSON, `{version: 1, meta, frames}`:

- `meta`: `title`, `playedAt`, `turns`, `frames`, `players` (`name`, `human`, `commander`),
  `winner`, `truncated` (more than 5000 frames: the recording stops early).
- `frames[0]` is the whole table; each next frame is a JSON merge patch (RFC 7386) on the one
  before. Cards are kept once, in `cards` by id, and zones list card ids, so a frame carries only
  what changed.
- The log travels apart: a frame's `logAdd` lines are added after cutting the log back to
  `logCut` lines (after a rewind took lines back).

A rewind during the game shows in the replay as a jump back, with the log line saying who asked.

## Upload

When the game ends, the server sends the file to `POST <Convex site URL>/replays` of the
deployment each player signed in with (staging or production, from their sign-in token's issuer).
`X-Replay-Meta` carries `meta` plus `users` (the players' Convex user ids), base64url JSON.
`Authorization: Bearer <REPLAY_SECRET>`.

## Setup

One shared secret, set in two places (never in the repo):

1. Convex, on each deployment (staging and production): `npx convex env set REPLAY_SECRET <secret>`.
2. The game server's environment: `REPLAY_SECRET=<secret>`.

Without `REPLAY_SECRET`, the game server doesn't record games at all, and Convex refuses uploads.

## Not yet

- Watching from one player's point of view (only what they could see then).
- Sharing a replay with someone who wasn't in the game.
