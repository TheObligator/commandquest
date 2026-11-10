// Run with `npm test` (Node's built-in test runner; Node 23.6+ runs TypeScript directly).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeDuplicates, parseDecklist, writeDecklist } from "../src/decklist.ts";

test("Moxfield / Arena export with sections and printings", () => {
  const r = parseDecklist(`Commander
1 Atraxa, Praetors' Voice (CM2) 10

Deck
1 Sol Ring (C21) 263
1 Arcane Signet (ELD) 331 *F*
10 Forest (UST) 216★

Sideboard
1 Doubling Season (A25) 159`);
  assert.deepEqual(r.errors, []);
  assert.equal(r.cards.length, 5);
  assert.deepEqual(r.cards[0], { name: "Atraxa, Praetors' Voice", quantity: 1, board: "commander", set: "cm2", collectorNumber: "10" });
  assert.deepEqual(r.cards[2], { name: "Arcane Signet", quantity: 1, board: "main", set: "eld", collectorNumber: "331" });
  assert.equal(r.cards[3].collectorNumber, "216★");
  assert.equal(r.cards[4].board, "side");
});

test("MTGO style with SB: prefix, bare names and 'x' quantities", () => {
  const r = parseDecklist("4 Lightning Bolt\n4x Counterspell\nBrainstorm\nSB: 2 Pyroblast\n");
  assert.deepEqual(
    r.cards.map((c) => [c.quantity, c.name, c.board]),
    [[4, "Lightning Bolt", "main"], [4, "Counterspell", "main"], [1, "Brainstorm", "main"], [2, "Pyroblast", "side"]],
  );
});

test("Archidekt categories and markers", () => {
  const r = parseDecklist(`1x Thelon of Havenwood (tsp) 227 [Commander{top}]
1x Cultivate (m21) 177 [Ramp]
2x Thallid (fem) 74a [Maybeboard{noDeck}{noPrice}]
1x Sol Ring *CMDR*
1x Fire // Ice (mh2) 290 ^Have,#37d67a^`);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.cards.map((c) => c.board), ["commander", "main", "maybe", "commander", "main"]);
  assert.equal(r.cards[2].collectorNumber, "74a");
  assert.equal(r.cards[4].name, "Fire // Ice");
});

test("Arena 'About' block names the deck, comments and token sections are skipped", () => {
  const r = parseDecklist("About\nName My Cool Deck\n\n// a comment\nDeck\n1 Island\n\nTokens\n1 Treasure\n");
  assert.equal(r.name, "My Cool Deck");
  assert.deepEqual(r.cards.map((c) => c.name), ["Island"]);
});

test("headers with counts and colons", () => {
  const r = parseDecklist("COMMANDER:\n1 Krenko, Mob Boss\nMainboard (99)\n99 Mountain");
  assert.deepEqual(r.cards.map((c) => c.board), ["commander", "main"]);
});

test("write then parse round-trips", () => {
  const cards = [
    { name: "Krenko, Mob Boss", quantity: 1, board: "commander" as const, set: "m13", collectorNumber: "139" },
    { name: "Mountain", quantity: 40, board: "main" as const },
    { name: "Goblin Bombardment", quantity: 1, board: "maybe" as const, set: "tpr", collectorNumber: "130" },
  ];
  const text = writeDecklist(cards);
  assert.match(text, /^Commander\n1 Krenko, Mob Boss \(M13\) 139\n\nDeck\n40 Mountain\n\nMaybeboard\n/);
  assert.deepEqual(parseDecklist(text).cards, cards);
});

test("merging duplicates", () => {
  const merged = mergeDuplicates([
    { name: "Island", quantity: 2, board: "main" as const },
    { name: "island", quantity: 3, board: "main" as const },
    { name: "Island", quantity: 1, board: "side" as const },
  ]);
  assert.deepEqual(merged.map((c) => c.quantity), [5, 1]);
});
