import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { gzipSync } from "node:zlib";
import { builtAt, COPY_FILE, MIN_CARDS, refresh, updateCardCategories } from "../scripts/cardcategories.ts";
import { buildCardCategories, CARD_CATEGORIES_VERSION, CardCategories, CATEGORY_RULES, type BulkTag, type CardCategoriesData } from "../src/cardCategories.ts";

const id = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-0000-0000-000000000000`;
const tag = (slug: string, cards: number[], more: Partial<BulkTag> = {}): BulkTag => ({ id: slug, slug, taggings: cards.map((n) => ({ oracle_id: id(n) })), ...more });

test("a tag brings the tags beneath it; -tag takes cards out; a tag can go by an alias", () => {
  const tags = [
    tag("removal", [1], { child_ids: ["removal-creature", "gone"] }),
    tag("removal-creature", [2], { child_ids: ["removal"] }), // a loop doesn't hang it
    tag("mill", [3, 4]),
    tag("surveil", [4]),
    tag("draw", [2, 4], { aliases: ["cards"] }),
  ];
  const c = new CardCategories(buildCardCategories(tags, new Date(), [["Removal", "removal"], ["Mill", "mill -surveil"], ["Draw", "cards"]]));
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => c.of(id(n))), [["Removal"], ["Removal", "Draw"], ["Mill"], ["Draw"], []]);
  assert.deepEqual(c.of(undefined), []);
  assert.deepEqual(c.names, ["Draw", "Mill", "Removal"]);
});

test("a rule naming a tag that's gone, or an empty category, is an error", () => {
  assert.throws(() => buildCardCategories([tag("a", [1])], new Date(), [["A", "a b"]]), /no tag "b"/);
  assert.throws(() => buildCardCategories([tag("a", [1])], new Date(), [["A", "a -a"]]), /no cards are in "A"/);
});

// ---- The committed copy ----

const ORACLE = {
  "Sol Ring": "6ad8011d-3471-4369-9d68-b264cc027487",
  Counterspell: "cc187110-1148-4090-bbb8-e205694a39f5",
  "Swords to Plowshares": "b1544f21-7e98-461b-aed5-e748b0168c52",
};

test("the committed copy is one this version can use, and knows some staples", () => {
  assert.ok(builtAt(COPY_FILE), "run `npm run cardcategories` and commit data/card-categories.json");
  const c = new CardCategories(JSON.parse(readFileSync(COPY_FILE, "utf8")) as CardCategoriesData);
  assert.deepEqual(c.names.length, CATEGORY_RULES.length, "the rules changed: run `npm run cardcategories`");
  assert.equal(c.of(ORACLE["Sol Ring"])[0], "Ramp");
  assert.equal(c.of(ORACLE.Counterspell)[0], "Counterspells");
  assert.equal(c.of(ORACLE["Swords to Plowshares"])[0], "Removal");
});

// ---- Downloading ----

const DAY = 24 * 60 * 60 * 1000;
const realFetch = globalThis.fetch;
const { log, warn } = console;
let dir: string;
let files: { out: string; copy: string };
let requests: number;

/** A list built `days` ago, with a first category to know it by. */
function list(file: string, days: number, name: string, version = CARD_CATEGORIES_VERSION) {
  writeFileSync(file, JSON.stringify({ version, built: new Date(Date.now() - days * DAY).toISOString(), categories: [name], cards: { "0": "0".repeat(MIN_CARDS * 10) } }));
}
const first = (file = files.out) => (JSON.parse(readFileSync(file, "utf8")) as CardCategoriesData).categories[0];

/** Every tag the rules use, on this many cards. */
function scryfall(status: number, cards = MIN_CARDS) {
  const slugs = [...new Set(CATEGORY_RULES.flatMap(([, t]) => t.split(" ").map((s) => s.replace(/^-/, ""))))];
  const body = gzipSync(slugs.map((s, i) => JSON.stringify(tag(s, s === "evasion" ? Array.from({ length: cards }, (_, n) => n + 1000) : [i + 1]))).join("\n"));
  globalThis.fetch = async (url) => {
    requests++;
    if (status !== 200) return new Response("down", { status });
    if (String(url).includes("api.scryfall.com")) return Response.json({ jsonl_download_uri: "https://data.scryfall.io/tags.jsonl.gz" });
    return new Response(new Uint8Array(body));
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cardcategories-"));
  files = { out: join(dir, "public.json"), copy: join(dir, "copy.json") };
  requests = 0;
  console.log = console.warn = () => {};
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(console, { log, warn });
  rmSync(dir, { recursive: true });
});

test("a list from today is used without asking Scryfall; an older one, or none, is downloaded again", async () => {
  scryfall(200);
  list(files.out, 0.5, "Last");
  await updateCardCategories(files);
  assert.equal(first(), "Last");
  assert.equal(requests, 0);
  list(files.out, 2, "Last");
  await updateCardCategories(files);
  assert.equal(first(), CATEGORY_RULES[0][0]);
  rmSync(files.out);
  await updateCardCategories(files);
  assert.equal(first(), CATEGORY_RULES[0][0]);
});

test("Scryfall down or cut short: the newer of the last list and the committed copy", async () => {
  scryfall(503);
  list(files.out, 2, "Last");
  list(files.copy, 5, "Copy");
  await updateCardCategories(files);
  assert.equal(first(), "Last");
  scryfall(200, 10);
  list(files.out, 9, "Last", CARD_CATEGORIES_VERSION + 1);
  await updateCardCategories(files);
  assert.equal(first(), "Copy");
});

test("refresh updates the copy, or throws and leaves both", async () => {
  scryfall(503);
  list(files.copy, 5, "Copy");
  await assert.rejects(refresh(files), /HTTP 503/);
  assert.equal(first(files.copy), "Copy");
  scryfall(200);
  await refresh(files);
  assert.equal(first(files.copy), CATEGORY_RULES[0][0]);
});
