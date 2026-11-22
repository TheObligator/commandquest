import { test } from "node:test";
import assert from "node:assert/strict";
import { columnSpans, columnsOf } from "../src/stackLayout.ts";

test("spare columns go to the types that make the row tall: the shortest row, with the fewest columns", () => {
  // Creature 15, Instant 7, Sorcery 14, Artifact 16, Enchantment 7, Land 22 (Island ×7 is one card)
  assert.deepEqual(columnSpans([15, 7, 14, 16, 7, 22], 7), [1, 1, 1, 1, 1, 2]); // 16 tall
  assert.deepEqual(columnSpans([15, 7, 14, 16, 7, 22], 8), [1, 1, 1, 2, 1, 2]); // 15 tall
  // Two tall types both split, as far as the columns allow.
  assert.deepEqual(columnSpans([30, 20, 5], 5), [2, 2, 1]);
  assert.deepEqual(columnSpans([12, 11, 10], 6), [2, 2, 2]);
  // Types about as tall as each other split together (one alone wouldn't shorten the row).
  assert.deepEqual(columnSpans([40, 20], 6), [3, 2]);
  assert.deepEqual(columnSpans([24, 24], 6), [3, 3]);
  // ... and with room for only one more column, nothing splits.
  assert.deepEqual(columnSpans([24, 24], 3), [1, 1]);
  // No spare columns: nothing splits.
  assert.deepEqual(columnSpans([30, 5, 5], 3), [1, 1, 1]);
  // Types with fewer than 7 pictures never split, so they set the lowest the row can get.
  assert.deepEqual(columnSpans([6, 2, 1], 9), [1, 1, 1]);
  assert.deepEqual(columnSpans([15, 7, 14, 16, 7, 6], 12), [3, 1, 2, 3, 1, 1]); // 7 tall
});

test("a type goes to three columns at most", () => {
  assert.deepEqual(columnSpans([36, 8, 6, 5], 6), [3, 1, 1, 1]);
  assert.deepEqual(columnSpans([36, 8, 6, 5], 12), [3, 1, 1, 1]);
  assert.deepEqual(columnSpans([36, 8, 6, 5], 5), [2, 1, 1, 1]);
});

test("removing a card never makes the row taller (unless a type drops below 7 and can't split)", () => {
  const height = (sizes: number[], spans: number[]) => Math.max(...sizes.map((n, i) => Math.ceil(n / spans[i])));
  for (const cols of [4, 6, 8, 10]) {
    for (let instants = 1; instants <= 50; instants++) {
      for (let lands = 8; lands <= 40; lands++) {
        const before = [7, instants, 7, 4, lands];
        const after = [7, instants, 7, 4, lands - 1];
        assert.ok(height(after, columnSpans(after, cols)) <= height(before, columnSpans(before, cols)), `${cols} columns, ${instants} instants, ${lands} lands`);
      }
    }
  }
});

test("columnsOf splits a group into columns, the first ones taking any extra cards", () => {
  assert.deepEqual(columnsOf([1, 2, 3, 4, 5], 2), [[1, 2, 3], [4, 5]]);
  assert.deepEqual(columnsOf([1, 2, 3, 4, 5, 6, 7], 3), [[1, 2, 3], [4, 5, 6], [7]]);
  assert.deepEqual(columnsOf([1, 2, 3], 1), [[1, 2, 3]]);
});
