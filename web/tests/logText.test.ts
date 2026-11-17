import { test } from "node:test";
import assert from "node:assert/strict";
import { logParts } from "../src/game/logText.ts";

const names: Record<number, string> = { 1138: "Forgotten Cave", 7: "Sol Ring", 9: "Rhystic Study" };
const nameOf = (id: number) => names[id];

test("a card named with its id becomes a card part, without the id", () => {
  assert.deepEqual(logParts("AI 2 played Forgotten Cave (1138)", nameOf), ["AI 2 played ", { id: 1138, name: "Forgotten Cave" }]);
  assert.deepEqual(logParts("Forgotten Cave (1138) enters tapped.", nameOf), [{ id: 1138, name: "Forgotten Cave" }, " enters tapped."]);
});

test("several cards in one line, and triggers", () => {
  assert.deepEqual(logParts("Rhystic Study (9) - Whenever an opponent casts a spell: AI 1 cast Sol Ring (7)", nameOf), [
    { id: 9, name: "Rhystic Study" }, " - Whenever an opponent casts a spell: AI 1 cast ", { id: 7, name: "Sol Ring" },
  ]);
});

test("unknown cards, wrong names and plain lines stay as written", () => {
  assert.deepEqual(logParts("Turn 1 (AI 2)", nameOf), ["Turn 1 (AI 2)"]);
  assert.deepEqual(logParts("AI 1 cast Counterspell (55)", nameOf), ["AI 1 cast Counterspell (55)"]);
  assert.deepEqual(logParts("AI 1 cast Island (7)", nameOf), ["AI 1 cast Island (7)"]);
  assert.deepEqual(logParts("", nameOf), []);
});
