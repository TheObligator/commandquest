import { test } from "node:test";
import assert from "node:assert/strict";
import { colorLetter, combos, manaChoiceFor, singles } from "../src/game/manaOptions.ts";

test("a filter land's two mana: WW, WU, UU", () => {
  const c = combos([{ mana: "W", max: 2 }, { mana: "U", max: 2 }], 2)!;
  assert.deepEqual(c.map((x) => x.cost), ["{W}{W}", "{W}{U}", "{U}{U}"]);
  assert.deepEqual(c.map((x) => x.answer), [[2, 0], [1, 1], [0, 2]]);
});

test("different colors only: at most one of each", () => {
  const c = combos([{ mana: "R", max: 1 }, { mana: "G", max: 1 }, { mana: "W", max: 1 }], 2)!;
  assert.deepEqual(c.map((x) => x.cost), ["{R}{G}", "{R}{W}", "{G}{W}"]);
});

test("too many ways: none (the rail's − / + panel does it)", () => {
  const five = ["W", "U", "B", "R", "G"].map((mana) => ({ mana, max: 3 }));
  assert.equal(combos(five, 3), null);
});

test("one mana of a color, and color names", () => {
  assert.deepEqual(singles([{ mana: "B" }, { mana: "G" }]), [{ cost: "{B}", answer: [0] }, { cost: "{G}", answer: [1] }]);
  assert.equal(colorLetter("Blue"), "U");
  assert.equal(colorLetter("End Turn"), undefined);
});

test("asked by the card: a filter land's mana, a color, Forge's two-color prompt; not damage", () => {
  const gate = { id: 7, kind: "distribute", mana: true, message: "Divide 2 mana", amount: 2, min: 0, max: 2,
    options: [{ label: "White", mana: "W", max: 2 }, { label: "Blue", mana: "U", max: 2 }], card: { id: 42, name: "Mystic Gate" } };
  const v = manaChoiceFor(gate, null)!;
  assert.equal(v.cardId, 42);
  assert.equal(v.title, "Mystic Gate: which mana?");
  assert.equal(v.choices.length, 3);
  const color = { id: 8, kind: "choose", mana: true, message: "Select Mana to Produce", min: 1, max: 1,
    options: ["W", "U", "B"].map((mana) => ({ label: mana, mana })) };
  assert.deepEqual(manaChoiceFor(color, null)!.choices.map((c) => c.cost), ["{W}", "{U}", "{B}"]);
  const damage = { ...gate, mana: undefined };
  assert.equal(manaChoiceFor(damage, null), null);
  const two = { message: "Select Mana to Produce", ok: { label: "White" }, cancel: { label: "Blue" } };
  assert.equal(manaChoiceFor(null, two)!.via, "prompt");
  assert.equal(manaChoiceFor(null, { message: "", ok: { label: "OK" }, cancel: { label: "End Turn" } }), null);
});
