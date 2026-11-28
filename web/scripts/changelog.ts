// The changelog's data (web/changelog/, see its README) and the commands that change it:
//
//   npm run changelog:add -- --category new|improved|fixed --title "..." [--body "..."]
//       Writes one entry file to changelog/unreleased/. Do this with each user-facing change.
//   npm run release [-- --dry-run]
//       Promotes staging to production: rolls the unreleased entries into the next version
//       (src/changelog.ts nextVersion), commits that to staging, pushes staging, then fast-forwards
//       production and tags the version. Run it from a clean checkout of origin/staging.
//   npm run changelog:check
//       Fails when unreleased entries exist (CI runs it on production pushes, so a bare
//       `git push origin staging:production` that skipped the release step doesn't deploy).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  CATEGORIES,
  cutRelease,
  parseEntry,
  slugify,
  sortEntries,
  type Category,
  type Changelog,
  type Entry,
  type Release,
} from "../src/changelog.ts";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(WEB, "changelog");
const UNRELEASED = join(DIR, "unreleased");
const RELEASES = join(DIR, "releases.json");

function unreleasedFiles(): string[] {
  if (!existsSync(UNRELEASED)) return [];
  return readdirSync(UNRELEASED)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(UNRELEASED, f));
}

export function readUnreleased(): Entry[] {
  return sortEntries(unreleasedFiles().map((f) => parseEntry(JSON.parse(readFileSync(f, "utf8")), relative(WEB, f))));
}

export function readReleases(): Release[] {
  const data: unknown = JSON.parse(readFileSync(RELEASES, "utf8"));
  if (!Array.isArray(data)) throw new Error("changelog/releases.json: must be a list");
  return data.map((r: Release) => ({
    version: r.version,
    date: r.date,
    hotfix: !!r.hotfix,
    entries: r.entries.map((e, i) => parseEntry(e, `changelog/releases.json ${r.version} entry ${i + 1}`)),
  }));
}

/** What the site's build shows. The public site's build leaves out what isn't live yet. */
export function loadChangelog(mode: string): Changelog {
  return { releases: readReleases(), unreleased: mode === "production" ? [] : readUnreleased() };
}

/** The data files, so the dev server can reload when they change. */
export function changelogFiles(): string[] {
  return [RELEASES, ...unreleasedFiles()];
}

function add(args: string[]) {
  const { values } = parseArgs({
    args,
    options: { category: { type: "string" }, title: { type: "string" }, body: { type: "string" } },
  });
  const now = new Date();
  const entry = parseEntry(
    { category: values.category as Category, title: values.title, body: values.body, date: now.toISOString() },
    "changelog:add",
  );
  mkdirSync(UNRELEASED, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const file = join(UNRELEASED, `${stamp}-${slugify(entry.title)}.json`);
  writeFileSync(file, JSON.stringify(entry, null, 2) + "\n");
  console.log(`Added ${relative(process.cwd(), file)}`);
}

function check() {
  const entries = readUnreleased();
  readReleases();
  if (entries.length) {
    console.error(
      `${entries.length} changelog entr${entries.length === 1 ? "y isn't" : "ies aren't"} in a release yet.\n` +
        "Promote with `npm run release` (in web/), not a bare `git push origin staging:production`.",
    );
    process.exit(1);
  }
  console.log("Changelog: every entry is in a release.");
}

const git = (...a: string[]) => execFileSync("git", a, { cwd: WEB, encoding: "utf8" }).trim();
const run = (...a: string[]) => execFileSync("git", a, { cwd: WEB, stdio: "inherit" });

function release(args: string[]) {
  const { values } = parseArgs({ args, options: { "dry-run": { type: "boolean" } } });
  const dry = !!values["dry-run"];

  run("fetch", "origin", "staging", "production");
  if (git("status", "--porcelain")) throw new Error("The checkout has uncommitted changes. Release from a clean one.");
  const head = git("rev-parse", "HEAD");
  if (head !== git("rev-parse", "origin/staging")) {
    throw new Error("HEAD isn't origin/staging. Release from an up-to-date checkout of staging (git switch --detach origin/staging).");
  }
  if (git("merge-base", "origin/production", head) !== git("rev-parse", "origin/production")) {
    throw new Error("production has commits staging doesn't, so it can't be fast-forwarded. Sort that out by hand.");
  }

  const entries = readUnreleased();
  if (!entries.length) {
    throw new Error(
      "No changelog entries since the last release. Add one with `npm run changelog:add` (an internal-only " +
        "release can say so, e.g. --category improved --title \"Behind-the-scenes fixes\").",
    );
  }
  const releases = cutRelease(readReleases(), entries, new Date());
  const { version, hotfix } = releases[0];
  console.log(`\nv${version}${hotfix ? " (hotfix)" : ""}:`);
  for (const e of releases[0].entries) console.log(`  ${e.category.padEnd(8)} ${e.title}`);
  if (dry) {
    console.log("\nDry run: nothing written or pushed.");
    return;
  }

  writeFileSync(RELEASES, JSON.stringify(releases, null, 2) + "\n");
  for (const f of unreleasedFiles()) rmSync(f);
  run("add", "--all", "--", relative(WEB, DIR));
  run("commit", "-m", `Release v${version}${hotfix ? " (hotfix)" : ""}`);
  run("tag", `v${version}`);
  run("push", "origin", "HEAD:staging");
  run("push", "origin", "HEAD:production");
  run("push", "origin", `v${version}`);
  console.log(`\nReleased v${version}. Both sites deploy from it: watch the Web workflow runs.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "add") add(rest);
    else if (cmd === "check") check();
    else if (cmd === "release") release(rest);
    else throw new Error(`Usage: changelog.ts add|check|release (categories: ${CATEGORIES.join(", ")})`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
