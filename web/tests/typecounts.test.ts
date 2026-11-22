// The deck bar's type counts (src/typecounts.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { typeCounts } from "../src/typecounts.ts";

test("every type counts a card; subtypes go to the type they belong to", () => {
  const c = typeCounts([
    { quantity: 1, typeLine: "Artifact Creature — Golem" },
    { quantity: 2, typeLine: "Creature — Zombie Rat" },
    { quantity: 1, typeLine: "Artifact — Equipment" },
    { quantity: 30, typeLine: "Basic Land — Swamp" },
    { quantity: 1, typeLine: "Tribal Instant — Elf" },
    { quantity: 1, typeLine: "Sorcery // Land" },
    { quantity: 1, typeLine: "Legendary Enchantment Creature — God" },
  ]);
  assert.equal(c.get("Creature")!.count, 4);
  assert.equal(c.get("Artifact")!.count, 2);
  assert.equal(c.get("Enchantment")!.count, 1);
  assert.equal(c.get("Land")!.count, 30);
  assert.equal(c.get("Kindred")!.count, 1);
  assert.equal(c.get("Sorcery")!.count, 1);
  assert.deepEqual(c.get("Creature")!.subtypes, [
    { name: "Rat", count: 2 },
    { name: "Zombie", count: 2 },
    { name: "God", count: 1 },
    { name: "Golem", count: 1 },
  ]);
  assert.deepEqual(c.get("Artifact")!.subtypes, [{ name: "Equipment", count: 1 }]);
  assert.deepEqual(c.get("Land")!.subtypes, [{ name: "Swamp", count: 30 }]);
  assert.deepEqual(c.get("Kindred")!.subtypes, [{ name: "Elf", count: 1 }]);
  assert.deepEqual(c.get("Instant")!.subtypes, []);
});
