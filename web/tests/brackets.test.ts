import { test } from "node:test";
import assert from "node:assert/strict";
import { batchQueries, bracketFloor, glance, total } from "../src/brackets.ts";

test("bracketFloor: Game Changers, mass land denial and extra turns set the lowest bracket", () => {
  assert.deepEqual(bracketFloor({ gameChangers: 0, massLandDenial: 0, extraTurns: 0 }), { bracket: 1, reasons: [] });
  assert.equal(bracketFloor({ gameChangers: 0, massLandDenial: 0, extraTurns: 1 }).bracket, 2);
  assert.equal(bracketFloor({ gameChangers: 1, massLandDenial: 0, extraTurns: 0 }).bracket, 3);
  assert.equal(bracketFloor({ gameChangers: 3, massLandDenial: 0, extraTurns: 0 }).bracket, 3);
  assert.equal(bracketFloor({ gameChangers: 4, massLandDenial: 0, extraTurns: 0 }).bracket, 4);
  const f = bracketFloor({ gameChangers: 2, massLandDenial: 1, extraTurns: 2 });
  assert.equal(f.bracket, 4);
  assert.deepEqual(f.reasons.map((r) => r.bracket), [4, 3, 2], "highest reason first");
});

test("glance counts Game Changers, fast mana and tagged cards, with interaction counting each card once", () => {
  const cards = [
    { name: "Rhystic Study", quantity: 1, gameChanger: true },
    { name: "Sol Ring", quantity: 1 },
    { name: "Swords to Plowshares", quantity: 1 },
    { name: "Fierce Guardianship", quantity: 1, gameChanger: true },
    { name: "Forest", quantity: 30 },
  ];
  const tagged = new Map([
    ["removal", new Set(["swords to plowshares"])],
    ["counterspell", new Set(["fierce guardianship"])],
    ["boardWipe", new Set(["swords to plowshares"])], // pretend it's both: still one interaction card
    ["draw", new Set(["rhystic study"])],
  ]);
  const g = glance(cards, tagged);
  assert.deepEqual(g.get("gameChanger")!.map((c) => c.name), ["Rhystic Study", "Fierce Guardianship"]);
  assert.deepEqual(g.get("fastMana")!.map((c) => c.name), ["Sol Ring"]);
  assert.equal(total(g.get("interaction")), 2);
  assert.equal(total(g.get("draw")), 1);
  assert.equal(total(g.get("tutor")), 0, "categories not looked up yet count 0");
});

test("batchQueries splits names into exact-name queries that fit Scryfall's length limit", () => {
  const names = Array.from({ length: 60 }, (_, i) => `Card Number ${i}`);
  const qs = batchQueries("otag:tutor", names, 300);
  assert.ok(qs.length > 1);
  assert.ok(qs.every((q) => q.query.length <= 300));
  assert.deepEqual(qs.flatMap((q) => q.names), names);
  assert.equal(batchQueries("otag:ramp", ['Say "Hi"'])[0].query, 'otag:ramp (!"Say Hi")');
  assert.equal(batchQueries("otag:ramp", ["Sol Ring", "Fire // Ice"])[0].query, 'otag:ramp (!"Sol Ring" or !"Fire // Ice")');
});
