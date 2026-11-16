import { test } from "node:test";
import assert from "node:assert/strict";
import { columnsOf, doubledGroups } from "../src/stackLayout.ts";

const doubled = (sizes: number[], cols: number) => [...doubledGroups(sizes, cols)].sort();

test("only the column that sets the row's height splits, and only when that's clearly worth it", () => {
  // Creature 15, Instant 7, Sorcery 14, Artifact 16, Enchantment 7, Land 22 (Island ×7 is one card)
  assert.deepEqual(doubled([15, 7, 14, 16, 7, 22], 7), [5]);
  // More room: splitting Artifact (16) next would only save one card (Creature is 15), so it doesn't.
  assert.deepEqual(doubled([15, 7, 14, 16, 7, 22], 8), [5]);
  // Lands with few unique cards (6 pictures) never split, and nothing else is clearly taller.
  assert.deepEqual(doubled([15, 7, 14, 16, 7, 6], 12), []);
  // Two clearly tall columns both split when there are two spare columns.
  assert.deepEqual(doubled([30, 20, 5], 5), [0, 1]);
  // Barely taller than the next column: splitting saves too little.
  assert.deepEqual(doubled([12, 11, 10], 6), []);
  // No spare columns: nothing splits.
  assert.deepEqual(doubled([30, 5, 5], 3), []);
  // Small groups stay whole.
  assert.deepEqual(doubled([6, 2, 1], 9), []);
});

test("columnsOf splits a group in two, the first column taking the extra card", () => {
  assert.deepEqual(columnsOf([1, 2, 3, 4, 5], true), [[1, 2, 3], [4, 5]]);
  assert.deepEqual(columnsOf([1, 2, 3], false), [[1, 2, 3]]);
});
