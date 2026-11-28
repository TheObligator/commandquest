// Changelog versions and entries (src/changelog.ts, scripts/changelog.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cutRelease, nextVersion, parseEntry, slugify, type Release } from "../src/changelog.ts";
import { loadChangelog, readReleases, readUnreleased } from "../scripts/changelog.ts";

const H = 60 * 60 * 1000;
const t0 = Date.parse("2026-12-01T12:00:00Z");
const rel = (version: string, at: number, hotfix = false): Release => ({ version, date: new Date(at).toISOString(), hotfix, entries: [] });

test("the first release is 1.0.0", () => {
  assert.deepEqual(nextVersion([], new Date(t0)), { version: "1.0.0", hotfix: false });
});

test("a promotion more than 48 hours after the last release is a minor bump", () => {
  assert.deepEqual(nextVersion([rel("1.2.0", t0)], new Date(t0 + 49 * H)), { version: "1.3.0", hotfix: false });
});

test("within 48 hours it's a hotfix: a patch bump", () => {
  assert.deepEqual(nextVersion([rel("1.2.0", t0)], new Date(t0 + 47 * H)), { version: "1.2.1", hotfix: true });
});

test("the hotfix window counts from the last normal release, so hotfixes don't chain", () => {
  const releases = [rel("1.2.1", t0 + 40 * H, true), rel("1.2.0", t0)];
  assert.deepEqual(nextVersion(releases, new Date(t0 + 47 * H)), { version: "1.2.2", hotfix: true });
  assert.deepEqual(nextVersion(releases, new Date(t0 + 50 * H)), { version: "1.3.0", hotfix: false });
});

test("cutting a release puts it on top with its entries sorted New, Improved, Fixed", () => {
  const e = (category: "new" | "improved" | "fixed", title: string, h: number) => ({ category, title, date: new Date(t0 + h * H).toISOString() });
  const [top, prev] = cutRelease([rel("1.0.0", t0)], [e("fixed", "b", 1), e("new", "a", 2), e("fixed", "a", 0)], new Date(t0 + 72 * H));
  assert.equal(top.version, "1.1.0");
  assert.equal(prev.version, "1.0.0");
  assert.deepEqual(top.entries.map((x) => x.category + " " + x.title), ["new a", "fixed a", "fixed b"]);
});

test("bad entries are refused with the file named", () => {
  assert.throws(() => parseEntry({ category: "news", title: "x", date: "2026-12-01" }, "a.json"), /a\.json: category/);
  assert.throws(() => parseEntry({ category: "new", title: " ", date: "2026-12-01" }, "a.json"), /needs a title/);
  assert.deepEqual(parseEntry({ category: "new", title: " Hi ", body: "", date: "2026-12-01" }, "a.json"), {
    category: "new",
    title: "Hi",
    date: "2026-12-01",
  });
});

test("slugs are short and file-name safe", () => {
  assert.equal(slugify("Counterspells: click a spell!"), "counterspells-click-a-spell");
  assert.equal(slugify("!!!"), "change");
});

test("the committed changelog files are valid, newest release first", () => {
  const releases = readReleases();
  assert.ok(releases.length > 0);
  for (let i = 1; i < releases.length; i++) assert.ok(Date.parse(releases[i - 1].date) >= Date.parse(releases[i].date));
  readUnreleased();
  assert.deepEqual(loadChangelog("production").unreleased, []);
});
