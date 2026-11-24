import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { gzipSync } from "node:zlib";
import { builtAt, COPY_FILE, updateCardNames } from "../scripts/cardnames.ts";
import { CARD_NAMES_VERSION } from "../src/cardsearch.ts";

const DAY = 24 * 60 * 60 * 1000;
const realFetch = globalThis.fetch;
const { log, warn } = console;
let dir: string;
let files: { out: string; copy: string };
let requests: number;

/** A list built `days` ago, with a first name to know it by. */
function list(file: string, days: number, name: string, version = CARD_NAMES_VERSION) {
  const names = [name, ...Array.from({ length: 30_000 }, (_, i) => `Card ${i}`)];
  writeFileSync(file, JSON.stringify({ version, built: new Date(Date.now() - days * DAY).toISOString(), names }));
}
const firstName = () => (JSON.parse(readFileSync(files.out, "utf8")) as { names: string[] }).names[0];

function scryfall(status: number, cards = 30_000) {
  globalThis.fetch = async (url) => {
    requests++;
    if (status !== 200) return new Response("down", { status });
    if (String(url).includes("api.scryfall.com")) return Response.json({ jsonl_download_uri: "https://data.scryfall.io/cards.jsonl.gz" });
    const lines = Array.from({ length: cards }, (_, i) => JSON.stringify({ name: i ? `Card ${i}` : "Downloaded", layout: "normal", color_identity: [], edhrec_rank: i + 1 }));
    return new Response(new Uint8Array(gzipSync(lines.join("\n"))));
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cardnames-"));
  files = { out: join(dir, "public.json"), copy: join(dir, "copy.json") };
  requests = 0;
  console.log = console.warn = () => {};
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(console, { log, warn });
  rmSync(dir, { recursive: true });
});

test("the committed copy is one this version can use", () => {
  assert.ok(builtAt(COPY_FILE), "run `npm run cardnames` and commit data/card-names.json");
});

test("a list from today is used without asking Scryfall", async () => {
  scryfall(200);
  list(files.out, 0.5, "Last");
  await updateCardNames(files);
  assert.equal(firstName(), "Last");
  assert.equal(requests, 0);
});

test("an older list, or none, is downloaded again", async () => {
  scryfall(200);
  list(files.out, 2, "Last");
  await updateCardNames(files);
  assert.equal(firstName(), "Downloaded");
  rmSync(files.out);
  await updateCardNames(files);
  assert.equal(firstName(), "Downloaded");
});

test("Scryfall down: the newer of the last list and the committed copy", async () => {
  scryfall(503);
  list(files.out, 2, "Last");
  list(files.copy, 30, "Copy");
  await updateCardNames(files);
  assert.equal(firstName(), "Last");
  list(files.out, 60, "Last");
  await updateCardNames(files);
  assert.equal(firstName(), "Copy");
});

test("Scryfall down with no last list: the committed copy", async () => {
  scryfall(503);
  list(files.copy, 30, "Copy");
  await updateCardNames(files);
  assert.equal(firstName(), "Copy");
});

test("Scryfall's data cut short counts as down", async () => {
  scryfall(200, 100);
  list(files.out, 2, "Last");
  await updateCardNames(files);
  assert.equal(firstName(), "Last");
});

test("a list in another version's format is never used", async () => {
  scryfall(503);
  list(files.out, 0.1, "Old format", CARD_NAMES_VERSION - 1);
  list(files.copy, 30, "Copy");
  await updateCardNames(files);
  assert.equal(firstName(), "Copy");
  rmSync(files.copy);
  list(files.out, 0.1, "Old format", CARD_NAMES_VERSION - 1);
  await updateCardNames(files);
  assert.ok(!existsSync(files.out));
});
