// Chances of hitting land drops on curve (src/deckstats.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { atLeast, chanceOnCurve } from "../src/deckstats.ts";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-4, `${a} ≈ ${b}`);

test("hypergeometric: known values", () => {
  // 1 ace among 52 cards, 5 drawn: 5/52.
  near(atLeast(52, 4, 1, 1), 4 / 52);
  near(atLeast(52, 1, 5, 1), 5 / 52);
  // Both of 2 special cards in 2 draws from 4: 1/6.
  near(atLeast(4, 2, 2, 2), 1 / 6);
  assert.equal(atLeast(60, 24, 7, 0), 1);
  assert.equal(atLeast(60, 1, 7, 2), 0);
  assert.equal(atLeast(10, 10, 3, 3), 1);
});

test("on curve: more lands and being on the draw help", () => {
  const play = chanceOnCurve(99, 37, 2, true);
  const draw = chanceOnCurve(99, 37, 2, false);
  assert.ok(play > 0.85 && play < 0.95, String(play));
  assert.ok(draw > play);
  assert.ok(chanceOnCurve(99, 40, 4, true) > chanceOnCurve(99, 33, 4, true));
  assert.equal(chanceOnCurve(99, 37, 0, true), 1);
  // Turn 1 on the play: at least one land in the opening 7.
  near(chanceOnCurve(99, 37, 1, true), 1 - atLeast(99, 62, 7, 7));
});
