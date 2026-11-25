import { test } from "node:test";
import assert from "node:assert/strict";
import { canPickStep, canSaveLater, laterFor, laterText, withSavedLater, type LaterEntry, type SavedLater } from "../src/game/later.ts";

const FETCH = "{T}, Pay 1 life, Sacrifice Windswept Heath: Search your library for a Forest or Plains card.";
const entry = (o: Partial<LaterEntry>): LaterEntry => ({ id: 1, card: "Windswept Heath", label: FETCH, when: "BEFORE_MY_TURN", text: "", ...o });

test("laterFor: one card's by its id, every copy's by its name", () => {
  assert.equal(laterFor([entry({ cardId: 5 })], 5, "Windswept Heath", FETCH)?.id, 1);
  assert.equal(laterFor([entry({ cardId: 5 })], 6, "Windswept Heath", FETCH), undefined);
  assert.equal(laterFor([entry({ everyCopy: true })], 6, "Windswept Heath", FETCH)?.id, 1);
  assert.equal(laterFor([entry({ everyCopy: true })], 6, "Windswept Heath", "other"), undefined);
  assert.equal(laterFor(undefined, 6, "Windswept Heath", FETCH), undefined);
});

test("laterText says when", () => {
  assert.equal(laterText({ when: "BEFORE_MY_TURN" }), "End step before my turn");
  assert.equal(laterText({ when: "STEP", phase: "DRAW", whose: "ME" }), "My draw");
  assert.equal(laterText({ when: "STEP", phase: "END_OF_TURN", whose: "OPP" }), "An opponent's end step");
  assert.equal(laterText({ when: "STEP", phase: "UPKEEP", whose: "3" }, () => "Morgan"), "Morgan's upkeep");
});

test("canPickStep: steps with priority; sorcery speed only in your main phases", () => {
  assert.equal(canPickStep("UNTAP", "ME", false), false);
  assert.equal(canPickStep("UPKEEP", "3", false), true);
  assert.equal(canPickStep("MAIN1", "ME", true), true);
  assert.equal(canPickStep("MAIN1", "OPP", true), false);
  assert.equal(canPickStep("END_OF_TURN", "ME", true), false);
});

test("canSaveLater: every copy, and not one player's turn", () => {
  assert.equal(canSaveLater({ when: "MY_UPKEEP" }), false);
  assert.equal(canSaveLater({ when: "MY_UPKEEP", everyCopy: true }), true);
  assert.equal(canSaveLater({ when: "STEP", phase: "DRAW", whose: "OPP", everyCopy: true }), true);
  assert.equal(canSaveLater({ when: "STEP", phase: "DRAW", whose: "3", everyCopy: true }), false);
});

test("withSavedLater: adds, replaces and takes out", () => {
  let list: SavedLater[] = withSavedLater([], "A", "one", { when: "MY_UPKEEP", everyCopy: true, ask: true });
  assert.deepEqual(list, [{ card: "A", text: "one", when: "MY_UPKEEP", ask: true }]);
  list = withSavedLater(list, "A", "one", { when: "STEP", phase: "DRAW", whose: "ME", everyCopy: true });
  assert.deepEqual(list, [{ card: "A", text: "one", when: "STEP", phase: "DRAW", whose: "ME" }]);
  assert.deepEqual(withSavedLater(list, "A", "one", null), []);
});
