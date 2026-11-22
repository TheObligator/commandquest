import { test } from "node:test";
import assert from "node:assert/strict";
import { colorPips, manaProduction, percent } from "../src/colorstats.ts";

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
