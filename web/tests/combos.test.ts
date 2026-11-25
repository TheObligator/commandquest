import { test } from "node:test";
import assert from "node:assert/strict";
import { gainsText, groupSteps, newCombo, parseTimes, type Combo } from "../src/game/combos.ts";

const combo = (id: number, gains: string[] = []): Combo => ({ id, name: `Combo ${id}`, steps: [], gains, loops: true });

test("parseTimes: 1 to 1000", () => {
  assert.equal(parseTimes("10"), 10);
  assert.equal(parseTimes(" 1000 "), 1000);
  for (const bad of ["", "0", "1001", "-3", "2.5", "ten", "1e3"]) assert.equal(parseTimes(bad), null, bad);
});

test("gainsText and groupSteps", () => {
  assert.equal(gainsText(combo(1, ["+1 {C}", "−1 life"])), "+1 {C}, −1 life");
  assert.equal(gainsText(combo(1)), "changes nothing");
  assert.deepEqual(groupSteps(["Pass", "Pass", "Use A", "Pass"]), [{ text: "Pass", n: 2 }, { text: "Use A", n: 1 }, { text: "Pass", n: 1 }]);
});

test("newCombo: the one that wasn't there", () => {
  assert.equal(newCombo([combo(1)], [combo(1), combo(2)])?.id, 2);
  assert.equal(newCombo([combo(1)], [combo(1)]), undefined);
});
