// Drag select's hit test (src/marquee.ts): only the visible part of a card counts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boxBetween, caught, visibleParts, type Box } from "../src/marquee.ts";

const card = (left: number, top: number): Box => ({ left, top, right: left + 150, bottom: top + 209 });

test("in a stack each card shows only its strip above the next one; the last shows whole", () => {
  const stack = [card(0, 0), card(0, 22), card(0, 44)];
  assert.deepEqual(visibleParts(stack).map((b) => [b.top, b.bottom]), [[0, 22], [22, 44], [44, 253]]);
});

test("a box started below a card's strip doesn't catch the card behind", () => {
  const stack = [card(0, 0), card(0, 22), card(0, 44)];
  const vis = visibleParts(stack);
  // From inside the last card's area (over the first card's hidden body) down and to the right.
  assert.deepEqual(caught(boxBetween(-10, 100, 40, 300), vis), [2]);
  // Reaching up into the second card's strip catches it too, but not the first's.
  assert.deepEqual(caught(boxBetween(-10, 30, 40, 300), vis), [1, 2]);
  assert.deepEqual(caught(boxBetween(-10, 5, 40, 10), vis), [0]);
});

test("cards side by side, or in another column, don't hide each other", () => {
  const vis = visibleParts([card(0, 0), card(164, 0), card(0, 22)]);
  assert.deepEqual(vis.map((b) => b.bottom), [22, 209, 231]);
  assert.deepEqual(caught(boxBetween(160, 150, 170, 160), vis), [1]);
});

test("touching an edge isn't catching", () => {
  assert.deepEqual(caught(boxBetween(150, 0, 160, 10), visibleParts([card(0, 0)])), []);
});
