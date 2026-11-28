# Changelog data

The site's "What's new" page (`#/changelog`, `src/pages/Changelog.tsx`) is built from these files.

- `unreleased/*.json`: one file per change on `staging` that isn't live yet. One file each so parallel
  branches never conflict. The staging site shows them at the top of the page as "not live yet"; the public
  site's build leaves them out.
- `releases.json`: every version that went live, newest first. Only `npm run release` writes it.

## Adding an entry

With each user-facing change, in the same commit (from `web/`):

```sh
npm run changelog:add -- --category new --title "Counterspells: click a spell in the stack to target it"
npm run changelog:add -- --category fixed --title "..." --body "Optional detail, shown under the title."
```

Categories: `new` (a feature), `improved` (a feature works better), `fixed` (a bug). Write for players. Skip
internal changes (refactors, tests, docs, CI). Fix a typo by editing the file.

## Releasing (promoting staging to production)

From a clean checkout of `origin/staging` (`git switch --detach origin/staging`), in `web/`:

```sh
npm run release -- --dry-run   # shows the version and its entries
npm run release
```

It moves every unreleased entry into a new version in `releases.json`, commits `Release vX.Y.Z`, tags it, and
pushes `staging`, then `production` (a fast-forward) and the tag. Both sites deploy from that commit.

Versions (`nextVersion` in `src/changelog.ts`):

- Normally a **minor** bump: 1.2.0 → 1.3.0.
- Within **48 hours** of the last normal release it's a **hotfix**: a patch bump (1.3.0 → 1.3.1 → 1.3.2),
  badged "Hotfix" on the page. The 48 hours count from the last normal release, so daily hotfixes don't chain.

CI (`.github/workflows/web.yml`) runs `npm run changelog:check` on every push to `production`, which fails while
unreleased entries exist, so a bare `git push origin staging:production` doesn't deploy.
