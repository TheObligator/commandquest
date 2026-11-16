import { test } from "node:test";
import assert from "node:assert/strict";
import { colorPips, landSources, percent } from "../src/colorstats.ts";

test("colorPips counts colored symbols, hybrid for both colors, times copies", () => {
  const p = colorPips([
    { quantity: 1, manaCost: "{2}{W}{W}" },
    { quantity: 2, manaCost: "{W/U}{B/P}{2/R}" },
    { quantity: 1, manaCost: "{X}{C}{G} // {1}{G}" },
    { quantity: 1 },
  ]);
  assert.deepEqual(p, { W: 4, U: 2, B: 2, R: 2, G: 2 });
});

test("landSources counts the lands that can make each color", () => {
  const s = landSources([
    { quantity: 10, produced: ["G"] },
    { quantity: 1, produced: ["W", "U", "B", "R", "G"] },
    { quantity: 2, produced: ["C"] },
    { quantity: 1 },
  ]);
  assert.equal(s.total, 14);
  assert.deepEqual(s.byColor, { W: 1, U: 1, B: 1, R: 1, G: 11 });
  assert.equal(percent(11, 14), "79%");
  assert.equal(percent(3, 0), "0%");
});
