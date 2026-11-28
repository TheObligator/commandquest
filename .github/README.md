<div align="center">

# CommandQuest

**Four-player Commander in your browser, judged by a real rules engine.**

[**Play at commandquest.app**](https://commandquest.app) · [Staging](https://staging.commandquest.app) · [Docs](../docs/web-dev.md)

[![Web](https://github.com/TheObligator/commandquest/actions/workflows/web.yml/badge.svg?branch=staging)](https://github.com/TheObligator/commandquest/actions/workflows/web.yml)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](../LICENSE)

</div>

---

CommandQuest is a free web client for Magic: The Gathering, built for Commander. You bring a deck,
and the [Forge](https://github.com/Card-Forge/forge) rules engine handles the stack, the triggers,
the state-based actions and the combat math, for more than 30,000 cards. When the engine gets
something wrong, or you do, **free play** lets you fix it by hand and **rewind** takes the game
back. Nothing to install: it runs in any modern browser.

## What you can do

| | |
|---|---|
| **Play against the AI** | Sit down with up to three Forge AI opponents under Commander rules. Games survive a reload or a dropped connection. |
| **Free play** | The rules engine judges, but you're never stuck with it. Like at a paper table, you can tap, move, flip or copy your cards by hand, add counters, grant until-end-of-turn effects, draw, scry, mill or search your library, and cast a card free or from any zone when a new card isn't scripted right. Everything done by hand is marked "(by hand)" in the game log. |
| **Rewind** | Misclicked, or forgot a blocker? Take the game back along a timeline of its moments, as far as the host allows: the last action, the current step, the turn or the turn before. Every other player has to agree. Until combat damage, attackers and blockers can be declared again from what you had. |
| **Replays** | Watch finished games again, every hand face up, moment by moment. Your last five games are kept automatically, and you can save five more. |
| **Build decks** | Search every card on Scryfall, sort by type, and check your mana curve and color identity. |
| **Import from anywhere** | Paste a Moxfield or Archidekt link or a text export, or upload a `.txt` file. |
| **Start from a precon** | Every Commander precon, Secret Lair decks included, opens instantly as stacked, spread, grid or list. |
| **Read the rulings** | Card details show the official Oracle text and rulings. |
| **Control priority** | Per-step, per-opponent stops on a phase strip, so you only stop when you want to respond. See [`docs/stops.md`](../docs/stops.md). |
| **Keep your decks** | Sign in with email, Google or Discord and your decks follow you to any device. |

**Coming next:** multiplayer tables with friends, invited with a link or a table code.

## How it works

```
 browser (web/)  ──── WebSocket ────  game server (forge-web-server/)  ──  Forge rules engine
   React + Vite                        Java 17, one session per game        forge-game, forge-ai
       │
       └──── Convex: accounts, decks, stop presets
```

- **`web/`**: the TypeScript and React frontend, deployed to Cloudflare. Card images and card data
  come from [Scryfall](https://scryfall.com) at runtime.
- **`forge-web-server/`**: a Java server that runs live games on Forge's engine and talks to the
  browser over WebSockets.
- **`overrides/`**: our card fixes, kept apart from Forge's card scripts so upstream updates merge
  cleanly.
- Everything else in this repository is upstream Forge, kept as close to untouched as possible.

## Run it locally

You need JDK 17, Maven 3.8.1+ and Node.js 20+.

```sh
# game server, from the repo root
mvn -f forge-web-server/reactor.xml package
java -jar forge-web-server/target/forge-web-server-*-all.jar

# frontend
cd web && npm install && npm run dev
```

The full setup, including a local Convex backend, is in [`docs/web-dev.md`](../docs/web-dev.md).
Deployment is described in [`docs/deploy.md`](../docs/deploy.md).

## Contributing

Read [`AGENTS.md`](../AGENTS.md) first. The short version:

- Work happens on `staging`, which deploys to the staging site. `production` is the public site. `master` mirrors
  upstream Forge and never gets our commits.
- Our code lives in `forge-web-server/`, `web/`, `overrides/` and `docs/`. Upstream files are
  read-only unless there's no other way, and any change to one is recorded in
  [`docs/upstream-hooks.md`](../docs/upstream-hooks.md).
- Card fixes go in `overrides/cards/` with a scenario test, never in `forge-gui/res/cardsfolder/`.

Rules bugs that also happen in desktop Forge belong [upstream](https://github.com/Card-Forge/forge/issues).

## Credits and license

CommandQuest stands on the work of the [Forge](https://github.com/Card-Forge/forge) community, who
built and maintain the rules engine, the AI and the card scripts. Card data and images are provided
by [Scryfall](https://scryfall.com).

Licensed under the [GNU GPL v3.0](../LICENSE), the same as Forge.

CommandQuest is unofficial Fan Content permitted under the
[Wizards of the Coast Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy).
It is not approved or endorsed by Wizards. Portions of the materials used are property of Wizards
of the Coast. © Wizards of the Coast LLC.
