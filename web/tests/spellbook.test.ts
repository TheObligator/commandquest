import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCombos } from "../convex/model/spellbook.ts";
import { comboCards, deckKey, guideProgress, guideSteps, isReady, showsResult, type MyZones, type SpellbookCombo } from "../src/game/spellbook.ts";

// As backend.commanderspellbook.com answers (trimmed).
const ANSWER = {
  count: null, next: null, previous: null,
  results: {
    identity: "C",
    included: [{
      id: "4131-4547",
      uses: [
        { card: { name: "Basalt Monolith" }, zoneLocations: ["B"], quantity: 1, mustBeCommander: false },
        { card: { name: "Rings of Brighthearth" }, zoneLocations: ["B"], quantity: 1, mustBeCommander: false },
      ],
      requires: [],
      produces: [{ feature: { name: "Infinite colorless mana" }, quantity: 1 }],
      manaNeeded: "{2}", easyPrerequisites: "", notablePrerequisites: "",
      description: "Activate Basalt Monolith's first ability by tapping it, adding {C}{C}{C}.\nActivate Basalt Monolith's last ability by paying {3}.\nRings of Brighthearth triggers, causing you to pay {2} to copy Basalt Monolith's last ability.\nResolve the copy of Basalt Monolith's last ability, untapping it.\nActivate Basalt Monolith's first ability by tapping it, adding {C}{C}{C}.\nResolve the Basalt Monolith ability from step 2, untapping it.\nRepeat.",
    }],
    almostIncluded: [
      { id: "a", uses: [{ card: { name: "Sol Ring" } }, { card: { name: "Hullbreaker Horror" } }], requires: [], produces: [{ feature: { name: "Infinite storm count" } }], description: "" },
      { id: "b", uses: [{ card: { name: "One" } }, { card: { name: "Two" } }], requires: [], produces: [], description: "" },
    ],
  },
};
const { combos, near, more } = parseCombos(ANSWER, ["Basalt Monolith", "Rings of Brighthearth", "Sol Ring"]);
const rings = combos[0];

test("parseCombos: the deck's combos, and those exactly one card away", () => {
  assert.equal(more, false);
  assert.deepEqual(rings.cards, [{ name: "Basalt Monolith", zones: "B" }, { name: "Rings of Brighthearth", zones: "B" }]);
  assert.equal(rings.mana, "{2}");
  assert.equal(rings.before, undefined);
  assert.equal(rings.steps.length, 7);
  assert.deepEqual(near, [{ id: "a", cards: ["Sol Ring", "Hullbreaker Horror"], missing: "Hullbreaker Horror", results: ["Infinite storm count"] }]);
  assert.equal(comboCards(rings), "Basalt Monolith + Rings of Brighthearth");
  assert.throws(() => parseCombos({ detail: "no" }, []));
  assert.throws(() => parseCombos(null, []));
});

test("deckKey: the cards played and who commands, in any order; not the sideboard", () => {
  const a = [{ name: "A", quantity: 1, board: "main" }, { name: "B", quantity: 1, board: "commander" }];
  assert.equal(deckKey(a), deckKey([...a].reverse()));
  assert.equal(deckKey(a), deckKey([...a, { name: "C", quantity: 1, board: "side" }]));
  assert.notEqual(deckKey(a), deckKey([{ ...a[0], board: "commander" }, a[1]]));
  assert.notEqual(deckKey(a), deckKey([{ ...a[0], quantity: 2 }, a[1]]));
  assert.match(deckKey([]), /^[0-9a-f]{16}$/);
});

test("isReady: every named card where it can be", () => {
  const zones = (o: Partial<MyZones>): MyZones => ({ H: [], B: [], C: [], E: [], G: [], ...o });
  assert.equal(isReady(rings, zones({ B: [{ name: "Basalt Monolith" }, { name: "Rings of Brighthearth" }] })), true);
  assert.equal(isReady(rings, zones({ B: [{ name: "Basalt Monolith" }], H: [{ name: "Rings of Brighthearth" }] })), false);
  const c = (cards: SpellbookCombo["cards"]): SpellbookCombo => ({ ...rings, cards });
  assert.equal(isReady(c([{ name: "Malakir Rebirth // Malakir Mire", zones: "HB" }]), zones({ H: [{ name: "Malakir Rebirth" }] })), true);
  assert.equal(isReady(c([{ name: "Kinnan", zones: "B", commander: true }]), zones({ B: [{ name: "Kinnan" }] })), false);
  assert.equal(isReady(c([{ name: "Kinnan", zones: "B", commander: true }]), zones({ B: [{ name: "Kinnan", commander: true }] })), true);
  assert.equal(isReady(c([{ name: "Rat", zones: "B", quantity: 2 }]), zones({ B: [{ name: "Rat" }] })), false);
  assert.equal(isReady(c([{ name: "Rat", zones: "B", quantity: 2 }]), zones({ B: [{ name: "Rat" }, { name: "Rat" }] })), true);
  assert.equal(isReady(c([{ name: "Squee", zones: "L" }]), zones({})), true, "in the library as far as we can tell");
  assert.equal(isReady(c([{ name: "Squee", zones: "L" }]), zones({ G: [{ name: "Squee" }] })), false);
});

test("guideSteps: without Repeat and what follows; an extra repeat within stays", () => {
  assert.equal(guideSteps(rings.steps).length, 6);
  assert.deepEqual(guideSteps(["A", "Repeat from step 1 one additional time.", "B", "Repeat.", "If so…"]), ["A", "Repeat from step 1 one additional time.", "B"]);
});

test("guideProgress: follows the recording", () => {
  const steps = guideSteps(rings.steps);
  const cards = rings.cards.map((c) => c.name);
  const at = (...r: string[]) => guideProgress(steps, r, cards);
  const TAP = "Basalt Monolith: Add {C}{C}{C}.";
  const UNTAP = "Basalt Monolith: Untap Basalt Monolith.";
  assert.equal(at(), 0);
  assert.equal(at(TAP), 1);
  assert.equal(at(TAP, UNTAP), 2);
  assert.equal(at(TAP, UNTAP, "Auto-pay", "Pass priority", "Answer: Yes"), 3);
  assert.equal(at(TAP, UNTAP, "Auto-pay", "Pass priority", "Answer: Yes", "Auto-pay", "Pass priority"), 4);
  assert.equal(at(TAP, UNTAP, "Auto-pay", "Pass priority", "Answer: Yes", "Pass priority", TAP, "Pass priority"), 6);
  assert.equal(at("Use Basalt Monolith"), 1);
  assert.equal(at("Tap for mana"), 1);
  assert.equal(at("Llanowar Elves: Add {G}."), 0);
});

test("showsResult: from what one time round changed, when it can tell", () => {
  assert.equal(showsResult("Infinite colorless mana", ["+1 {C}"]), true);
  assert.equal(showsResult("Infinite colorless mana", ["+1 life"]), false);
  assert.equal(showsResult("Infinite lifegain", ["+1 life"]), true);
  assert.equal(showsResult("Infinite lifeloss", ["Morgan: −1 life"]), true);
  assert.equal(showsResult("Infinite damage", ["−1 life"]), false);
  assert.equal(showsResult("Infinite creature tokens with haste", ["+1 Goblin token"]), true);
  assert.equal(showsResult("Infinite card draw", ["+1 card in hand", "−1 card in library"]), true);
  assert.equal(showsResult("Infinite mill", ["Morgan: −3 card in library"]), true);
  for (const r of ["Infinite lifegain triggers", "Infinite storm count", "Win the game", "Infinite untap of nonland permanents you control"]) assert.equal(showsResult(r, []), null, r);
});
