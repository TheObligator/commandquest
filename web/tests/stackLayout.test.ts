import { test } from "node:test";
import assert from "node:assert/strict";
import { columnSpans, columnsOf } from "../src/stackLayout.ts";

test("only the column that sets the row's height splits, and only when that's clearly worth it", () => {
  // Creature 15, Instant 7, Sorcery 14, Artifact 16, Enchantment 7, Land 22 (Island ×7 is one card)
  assert.deepEqual(columnSpans([15, 7, 14, 16, 7, 22], 7), [1, 1, 1, 1, 1, 2]);
  // More room: splitting Artifact (16) next would only save one card (Creature is 15), so it doesn't.
  assert.deepEqual(columnSpans([15, 7, 14, 16, 7, 22], 8), [1, 1, 1, 1, 1, 2]);
  // Lands with few unique cards (6 pictures) never split, and nothing else is clearly taller.
  assert.deepEqual(columnSpans([15, 7, 14, 16, 7, 6], 12), [1, 1, 1, 1, 1, 1]);
  // Two clearly tall columns both split when there are two spare columns.
  assert.deepEqual(columnSpans([30, 20, 5], 5), [2, 2, 1]);
  // Barely taller than the next column: splitting saves too little.
  assert.deepEqual(columnSpans([12, 11, 10], 6), [1, 1, 1]);
  // No spare columns: nothing splits.
  assert.deepEqual(columnSpans([30, 5, 5], 3), [1, 1, 1]);
  // Small groups stay whole.
  assert.deepEqual(columnSpans([6, 2, 1], 9), [1, 1, 1]);
});

test("a type far taller than the rest goes to three columns, but never more", () => {
  // Creatures 36: two columns of 18, still the tallest by far, so a third (12 each).
  assert.deepEqual(columnSpans([36, 8, 6, 5], 6), [3, 1, 1, 1]);
  // Plenty of room still stops at three.
  assert.deepEqual(columnSpans([36, 8, 6, 5], 12), [3, 1, 1, 1]);
  // Only one spare column: two.
  assert.deepEqual(columnSpans([36, 8, 6, 5], 5), [2, 1, 1, 1]);
  // Two columns of 11 against a 10: a third would save one card, so it stays at two.
  assert.deepEqual(columnSpans([22, 10, 4], 6), [2, 1, 1]);
  // The tallest after a split gets the next column: Creature 30 → 15, then Land 18 splits.
  assert.deepEqual(columnSpans([30, 18, 5], 5), [2, 2, 1]);
});

test("types about as tall as each other split together when one split alone wouldn't shorten the row", () => {
  // Instants 40 and Lands 20 in six columns: Instants to two (20) ties Lands, so both split: 14 and 10.
  assert.deepEqual(columnSpans([40, 20], 6), [3, 2]);
  // Two equal types both split.
  assert.deepEqual(columnSpans([24, 24], 6), [2, 2]);
  assert.deepEqual(columnSpans([20, 20, 3], 6), [2, 2, 1]);
  // But only with room for both: one spare column can't shorten the row, so nothing splits.
  assert.deepEqual(columnSpans([24, 24], 3), [1, 1]);
});

test("columnsOf splits a group into columns, the first ones taking any extra cards", () => {
  assert.deepEqual(columnsOf([1, 2, 3, 4, 5], 2), [[1, 2, 3], [4, 5]]);
  assert.deepEqual(columnsOf([1, 2, 3, 4, 5, 6, 7], 3), [[1, 2, 3], [4, 5, 6], [7]]);
  assert.deepEqual(columnsOf([1, 2, 3], 1), [[1, 2, 3]]);
});
