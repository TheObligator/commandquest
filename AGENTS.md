# AGENTS.md — Project rules for coding agents

This repository is a fork of [Card-Forge/forge](https://github.com/Card-Forge/forge) (GPL-3.0).
We are building a **web-based Magic: The Gathering client** (Commander-focused, 4-player) on top of
Forge's rules engine. Forge's own code is treated as an upstream dependency that we keep as close
to untouched as possible so upstream updates merge cleanly.

## Branches — follow these exactly

| Branch | What it is | Who moves it |
|---|---|---|
| `master` | A **clean mirror of upstream Forge** | Only ever updated by merging `upstream/master`. Never commit to it, and never merge our work into it |
| `web` | Our main branch. **Deploys to the staging site** | Our everyday commits |
| `live` | **The public site** (production) | Only fast-forwarded to a `web` commit that's been tested on staging, and only when the user asks |

- **Commit straight to `web`** in small, focused commits, one logical change each. `web` deploys to
  staging, so every commit must build and pass the tests (see Build and test).
- **Topic branches are optional.** Use one (`web-<feature>`, e.g. `web-stops-ui`) only when it earns
  its keep: an experiment that might get thrown away, a change that stays broken across several
  sessions, or several agents working in parallel (one branch or worktree each). Merge it back into
  `web` when it's done and passing. (`web/<feature>` is impossible: git can't have both a `web`
  branch and `web/...` branches.)
- **Never commit to `live` directly**, including fixes. Fix on `web`, check it on staging, then
  promote with `git push origin web:live`. That push only succeeds as a fast-forward, which is the point.
- Never push to the `upstream` remote. Never force-push. Never rewrite history on `master`, `web` or `live`.
- Before starting work, confirm the current branch with `git branch --show-current`. If it's
  `master` or `live`, stop and switch to `web` (or a topic branch off it) before changing anything.

## Staging and production

Neither site is hosted yet. Until they are, the only running copy is the local dev service
(`docs/web-dev.md`). Once they're set up:

- Staging runs the latest `web` and the public site runs `live`. They have **separate databases**.
  Never point staging at the production database, and never copy production user data into staging.
- Database migrations (`forge-web-server/.../db/Database.java`) only move forward and are never
  edited after they ship. Staging runs a migration first, and promoting to `live` runs it on
  production, so back up the production database before promoting a release that adds one.
- A change can be on staging for as long as it needs. Only promote once it works there.

## Where code goes

Our code lives only in these locations:

| Path | Purpose |
|---|---|
| `forge-web-server/` | Our Java server: WebSockets, game sessions, remote player controller, priority stops, manual-override actions |
| `web/` | Our TypeScript frontend |
| `overrides/` | Our card fixes (see below) |
| `docs/` | Our design notes and documentation |
| `.github/workflows/` | CI workflows |

**Everything else is upstream Forge and is read-only by default.** That includes `forge-core/`,
`forge-game/`, `forge-ai/`, `forge-gui/`, `forge-gui-desktop/`, `forge-gui-mobile/`, and the
card scripts in `forge-gui/res/cardsfolder/`.

### Upstream hooks (rare exceptions)

If our code truly cannot work without changing an upstream file:

1. Ask before making the change, and explain why it can't be done from our own modules.
2. Keep the change as small as possible — ideally a single call into our code.
3. Mark it with a comment: `// WEB-HOOK: <short reason>`.
4. Record it in `docs/upstream-hooks.md` (file, line, reason).

## Card fixes

- **Never edit files in `forge-gui/res/cardsfolder/`.** Card fixes go in `overrides/cards/`,
  using the same script format and file name as the upstream card.
- Every override needs an entry in `overrides/manifest.json`:
  - `upstream_hash`: SHA-256 of the upstream card file at the time of the fix,
    computed after normalizing line endings to LF
  - `reason`: what was broken
  - `date`
- Every override needs a scenario test that fails on the upstream version and passes with the fix.

## Build and test

- Requires a JDK (Java 17+) and Maven.
- Build the server with `mvn -f forge-web-server/reactor.xml package` (run from the repo root, because
  `.mvn/maven.config` uses a relative path). That reactor builds only `forge-core`, `forge-game`,
  `forge-ai`, `forge-gui` and our server, and it means the root `pom.xml` needs no edits. Don't add our module to
  the root pom.
- Frontend: `cd web && npm install && npm run build`. See `docs/web-dev.md`.
- Run the relevant tests before calling a task done. If you couldn't run them, say so.

## Conventions

- Line endings are LF, enforced by a `.gitattributes` (`* text=auto eol=lf`) in each of our top-level
  folders. Leave upstream's root `.gitattributes` alone; adding a new folder of ours means adding one
  there too. Don't introduce CRLF.
- License: everything here is GPL-3.0. Keep upstream license headers and the `LICENSE` file intact.
- Card images and card data for display come from Scryfall at runtime. Never commit card images.
- CI workflows trigger only on `push` (to our branches), `schedule`, and `workflow_dispatch`.
  Never use `pull_request_target`, and don't add `pull_request` triggers.
- Don't add secrets, tokens, or credentials to the repo.

## Ask before

- Changing any upstream file
- Adding a new dependency (Maven or npm)
- Deleting files or directories
- Changing CI workflows, licensing, or anything under `.github/`
- Promoting anything to `live` (and only the user decides when)
