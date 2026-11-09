# AGENTS.md — Project rules for coding agents

This repository is a fork of [Card-Forge/forge](https://github.com/Card-Forge/forge) (GPL-3.0).
We are building a **web-based Magic: The Gathering client** (Commander-focused, 4-player) on top of
Forge's rules engine. Forge's own code is treated as an upstream dependency that we keep as close
to untouched as possible so upstream updates merge cleanly.

## Branches — follow these exactly

- `master` is a **clean mirror of upstream Forge**. Never commit to it, never merge our work into it.
  It is only ever updated by merging `upstream/master`.
- `web` is our main development branch. All of our work ends up here.
- For each task, create a feature branch off `web` (e.g. `web/feature-stops-ui`) unless told otherwise.
- Never push to the `upstream` remote. Never force-push. Never rewrite history on `web` or `master`.
- Before starting work, confirm the current branch with `git branch --show-current`. If it is
  `master`, stop and switch to `web` (or a feature branch off it) before changing anything.

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
- Prefer building only what's needed: `mvn -pl forge-web-server -am` rather than the full project.
- Run the relevant tests before calling a task done. If you couldn't run them, say so.

## Conventions

- Line endings are LF (enforced by `.gitattributes`). Don't introduce CRLF.
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
- Merging into `web`
