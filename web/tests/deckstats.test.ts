import { test } from "node:test";
import assert from "node:assert/strict";
import { deckAverages, playableLandBack } from "../src/deckstats.ts";

test("deckAverages: mana value with and without lands, and lands per opening hand", () => {
  const a = deckAverages([
    { quantity: 36, cmc: 0, land: true },
    { quantity: 1, cmc: 3, land: true }, // a land adds no mana value even if Scryfall gives it one
    { quantity: 30, cmc: 2, land: false },
    { quantity: 33, cmc: 4, land: false },
  ]);
  assert.equal(a.withoutLands, (60 + 132) / 63);
  assert.equal(a.withLands, (60 + 132) / 100);
  assert.equal(a.landsPerHand, (7 * 37) / 100);
});

test("deckAverages handles empty and all-land decks", () => {
  assert.deepEqual(deckAverages([]), { withLands: undefined, withoutLands: undefined, landsPerHand: undefined });
  const lands = deckAverages([{ quantity: 4, cmc: 0, land: true }]);
  assert.equal(lands.withoutLands, undefined);
  assert.equal(lands.landsPerHand, 4, "a deck under 7 cards draws all of it");
});

test("playableLandBack counts modal double-faced spells with a land back, not transforming cards", () => {
  const mdfc = (front: string, back: string, layout = "modal_dfc") => ({ layout, card_faces: [{ type_line: front }, { type_line: back }] });
  assert.equal(playableLandBack(mdfc("Sorcery", "Land")), true, "Emeria's Call");
  assert.equal(playableLandBack(mdfc("Legendary Creature — God", "Legendary Land")), true, "Valki-style god with a land back");
  assert.equal(playableLandBack(mdfc("Land", "Land")), false, "pathways are already lands");
  assert.equal(playableLandBack(mdfc("Legendary Creature — Vampire", "Legendary Land", "transform")), false, "transforms into a land");
  assert.equal(playableLandBack(mdfc("Instant", "Creature — Elf")), false);
  assert.equal(playableLandBack({ layout: "normal", type_line: "Land" }), false);
  assert.equal(playableLandBack(mdfc("Creature — Island Elemental", "Sorcery")), false, "subtypes don't count");
});
