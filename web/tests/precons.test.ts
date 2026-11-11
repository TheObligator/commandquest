import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { OUT_FILE, RES_DIR, buildPrecons, byNewest, parseDck, parseEdition, render, splitTitle, toPrecon, type Edition } from "../scripts/precons.ts";
import { cardCount, deckCards, matches, releaseLabel, type Precon } from "../src/precons.ts";

const editions = new Map<string, Edition>([
  ["C18", { code: "C18", scryfallCode: "c18", name: "Commander 2018", date: "2018-08-10" }],
  ["SLD", { code: "SLD", scryfallCode: "sld", name: "Secret Lair Drop", date: "2019-12-02" }],
  ["PCA", { code: "PCA", scryfallCode: "opca", name: "Planechase Anthology", date: "2016-11-25" }],
]);

test("parseEdition reads the code, Scryfall code, name and date", () => {
  assert.deepEqual(parseEdition("[metadata]\r\nCode=PCA\r\nDate=2016-11-25\r\nName=Planechase Anthology\r\nScryfallCode=OPCA\r\n[cards]\r\n1 C Foo"), {
    code: "PCA", scryfallCode: "opca", name: "Planechase Anthology", date: "2016-11-25",
  });
  assert.equal(parseEdition("[cards]\n1 C Foo"), null);
});

test("parseDck handles CRLF, any-case sections, art indexes and [collector numbers]", () => {
  const d = parseDck("[metadata]\r\nName=X\r\n[commander]\r\n1 Foo|C18|1\r\n[Main] \r\n2 Swamp|C18|3\r\n1 Sol Ring|FDC|[286]\r\n1 Bare Name\r\n1 Shiny+|NEC\r\n[Sideboard]\r\n");
  assert.equal(d.meta.name, "X");
  assert.deepEqual(d.sections.commander, [{ quantity: 1, name: "Foo", set: "C18", collectorNumber: "" }]);
  assert.deepEqual(d.sections.main, [
    { quantity: 2, name: "Swamp", set: "C18", collectorNumber: "" },
    { quantity: 1, name: "Sol Ring", set: "FDC", collectorNumber: "286" },
    { quantity: 1, name: "Bare Name", set: "", collectorNumber: "" },
    { quantity: 1, name: "Shiny", set: "NEC", collectorNumber: "" },
  ]);
});

test("splitTitle separates the set and year from Commander precon names", () => {
  assert.deepEqual(splitTitle("Adaptive Enchantment [C18] [2018]"), { name: "Adaptive Enchantment", set: "C18", year: "2018" });
  assert.deepEqual(splitTitle("Abzan Siege"), { name: "Abzan Siege" });
});

test("toPrecon maps set codes to Scryfall's and dates the deck", () => {
  const p = toPrecon("Adaptive Enchantment [C18] [2018].dck", "[metadata]\nName=Adaptive Enchantment [C18] [2018]\n[Commander]\n1 Estrid, the Masked|C18|1\n[Main]\n1 Plane Thing|PCA\n10 Forest|C18|2\n", "commander", editions)!;
  assert.equal(p.id, "adaptive-enchantment-c18-2018");
  assert.equal(p.name, "Adaptive Enchantment");
  assert.equal(p.set, "c18");
  assert.equal(p.date, "2018-08-10");
  assert.deepEqual(p.main[0], [1, "Plane Thing", "opca", ""]);
  assert.equal(cardCount(p), 12);
  assert.deepEqual(deckCards(p)[0], { name: "Estrid, the Masked", quantity: 1, board: "commander", set: "c18" });
  assert.ok(matches(p, "estrid") && matches(p, "commander 2018") && !matches(p, "atraxa"));
  // A Secret Lair deck from 2023 isn't dated by Secret Lair's first release.
  assert.equal(toPrecon("Y [SLD] [2023].dck", "[metadata]\nName=Y [SLD] [2023]\n[Main]\n1 Z|SLD\n", "commander", editions)!.date, "2023");
  assert.equal(toPrecon("Empty.dck", "[metadata]\nName=Empty\n", "constructed", editions), null);
});

test("byNewest sorts newest first, then by name, undated last", () => {
  const p = (name: string, date: string) => ({ name, date }) as Precon;
  const sorted = [p("B", "2018-08-10"), p("U", ""), p("A", "2018-08-10"), p("N", "2025-01-01"), p("Y", "2023")].sort(byNewest);
  assert.deepEqual(sorted.map((x) => x.name), ["N", "Y", "A", "B", "U"]);
  assert.equal(releaseLabel("2018-08-10"), "Aug 2018");
  assert.equal(releaseLabel("2023"), "2023");
});

// Forge's files aren't in CI's sparse checkout; locally this catches a stale public/precons.json.
test("public/precons.json is up to date with Forge's deck files (run `npm run precons`)", { skip: !existsSync(RES_DIR) && "Forge's res folder isn't checked out" }, () => {
  assert.ok(readFileSync(OUT_FILE, "utf8") === render(buildPrecons(RES_DIR)), "public/precons.json is stale: run `npm run precons`");
});

test("public/precons.json is newest first and every deck has cards", () => {
  const decks = JSON.parse(readFileSync(OUT_FILE, "utf8")) as Precon[];
  assert.ok(decks.length > 600);
  assert.ok(decks.some((d) => d.kind === "commander") && decks.some((d) => d.kind === "constructed"));
  for (let i = 1; i < decks.length; i++) assert.ok(byNewest(decks[i - 1], decks[i]) <= 0, `${decks[i - 1].name} before ${decks[i].name}`);
  for (const d of decks) {
    assert.ok(d.main.length, d.name);
    if (d.kind === "commander") assert.ok(d.commander.length, `${d.name} has no commander`);
  }
  assert.equal(new Set(decks.map((d) => d.id)).size, decks.length, "ids are unique");
});
