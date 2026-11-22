import { test } from "node:test";
import assert from "node:assert/strict";
import { colorPips, fetchColors, fetchReach, manaProduction, percent } from "../src/colorstats.ts";

test("colorPips counts colored symbols, hybrid for both colors, times copies", () => {
  const p = colorPips([
    { quantity: 1, manaCost: "{2}{W}{W}" },
    { quantity: 2, manaCost: "{W/U}{B/P}{2/R}" },
    { quantity: 1, manaCost: "{X}{C}{G} // {1}{G}" },
    { quantity: 1 },
  ]);
  assert.deepEqual(p, { W: 4, U: 2, B: 2, R: 2, G: 2, C: 1 });
});

test("manaProduction counts each color a source makes, limited to the deck's colors", () => {
  const sources = [
    { quantity: 10, produced: ["G"] },
    { quantity: 1, produced: ["W", "U", "B", "R", "G"] }, // Command Tower, Arcane Signet…
    { quantity: 2, produced: ["C"] },
    { quantity: 1 },
  ];
  assert.deepEqual(manaProduction(sources), { W: 1, U: 1, B: 1, R: 1, G: 11, C: 2 });
  assert.deepEqual(manaProduction(sources, ["G", "W"]), { W: 1, U: 0, B: 0, R: 0, G: 11, C: 2 });
  assert.equal(percent(11, 14), "79%");
  assert.equal(percent(3, 0), "0%");
});

const LANDS = [
  { typeLine: "Basic Land — Forest", produced: ["G"] },
  { typeLine: "Basic Land — Island", produced: ["U"] },
  { typeLine: "Land — Forest Mountain", produced: ["R", "G"] },
  { typeLine: "Land", produced: ["C"] },
];

test("fetchColors reads land searches from rules text", () => {
  const set = (o: string) => [...fetchColors(o, LANDS)].sort().join("");
  // Typed fetch: the types' colors plus what the deck's lands with those types make.
  assert.equal(set("{T}, Pay 1 life, Sacrifice Wooded Foothills: Search your library for a Mountain or Forest card, put it onto the battlefield, then shuffle."), "GR");
  assert.equal(set("Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle."), "BGRUW"); // a Mountain can be the Forest Mountain
  // Basic land: the deck's basics.
  assert.equal(set("Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle."), "GU");
  // Any land: everything the deck's lands make.
  assert.equal(set("Search your library for a land card, reveal it, put it into your hand, then shuffle."), "CGRU");
  // An opponent's library, or no search: nothing.
  assert.equal(set("Exile target creature. Its controller may search their library for a basic land card."), "");
  assert.equal(set("Draw a card."), "");
});

test("fetchReach counts colors a card can fetch but doesn't make, within the identity", () => {
  const r = fetchReach(
    [
      { quantity: 1, produced: [], oracle: "Search your library for a Mountain or Forest card, put it onto the battlefield." },
      { quantity: 2, produced: ["G"], oracle: "Search your library for a basic land card." },
      { quantity: 1, produced: ["G"], oracle: "{T}: Add {G}." },
    ],
    LANDS,
    ["G", "U"],
  );
  assert.deepEqual(r, { W: 0, U: 2, B: 0, R: 0, G: 1, C: 0 });
});
