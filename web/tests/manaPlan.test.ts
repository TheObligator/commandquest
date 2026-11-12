import { test } from "node:test";
import assert from "node:assert/strict";
import { colorsOf, initialPlan, shift, totals, type PlanCard } from "../src/game/manaPlan.ts";

const dual: PlanCard = { id: 1, picks: [{ mana: "W" }, { mana: "U" }] };
const plains: PlanCard = { id: 2, picks: [{ mana: "W" }] };
const island: PlanCard = { id: 3, picks: [{ mana: "U" }] };
const ring: PlanCard = { id: 4, picks: [{ mana: "CC" }, { mana: "U", via: "Urza" }] };
const thopter: PlanCard = { id: 5, picks: [{ mana: "U", via: "Urza" }] };

test("a dual, a plains and an island start as 2 of one and 1 of the other, and shift between them", () => {
  const cards = [plains, island, dual];
  const plan = initialPlan(cards);
  const t = totals(cards, plan);
  assert.equal((t.W ?? 0) + (t.U ?? 0), 3);
  const up = shift(cards, initialPlan(cards), "U", 1) ?? initialPlan(cards);
  const moreBlue = shift(cards, up, "U", 1);
  assert.equal(moreBlue, null, "only the dual can change, and it's already blue");
  assert.deepEqual(totals(cards, up), { W: 1, U: 2 });
  const down = shift(cards, up, "U", -1)!;
  assert.deepEqual(totals(cards, down), { W: 2, U: 1 }, "one less blue is one more white");
  assert.deepEqual(colorsOf(cards), ["W", "U"]);
});

test("own abilities first, or the one asked for; switching keeps the same amount when it can", () => {
  const cards = [ring, thopter];
  assert.deepEqual(totals(cards, initialPlan(cards)), { C: 2, U: 1 });
  assert.deepEqual(totals(cards, initialPlan(cards, "Urza")), { U: 2 });
  const blue = shift(cards, initialPlan(cards), "U", 1)!;
  assert.deepEqual(totals(cards, blue), { U: 2 }, "Sol Ring for Urza instead");
  assert.equal(shift(cards, blue, "U", 1), null);
});
