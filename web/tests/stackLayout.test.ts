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

test("packStacks: small groups share a column when they fit under the tallest group", async () => {
  const { packStacks } = await import("../src/stackLayout.ts");
  // Commander, 1 planeswalker, 35 creatures, 5 sorceries, 6 instants (Stacked: 15% of a covered card shows).
  const groups = [{ size: 1, whole: true }, { size: 1 }, { size: 35 }, { size: 5 }, { size: 6 }];
  const shape = (cols: number) => packStacks(groups, cols, 0.15).map((s) => `${s.groups.join("+")}${s.span > 1 ? `×${s.span}` : ""}`);
  // Three columns: the creatures stay one tall column, so everything small stacks beside them.
  assert.deepEqual(shape(3), ["0+1", "2", "3+4"]);
  // Four: the creatures split in two; the sorceries and instants stacked are then the row's height.
  assert.deepEqual(shape(4), ["0+1", "2×2", "3+4"]);
  // Six: the creatures split in three for a shorter row; the planeswalker still fits under the commander.
  assert.deepEqual(shape(6), ["0+1", "2×3", "3", "4"]);
  // No room: still one column per tall group, nothing lost.
  const tight = packStacks([{ size: 20 }, { size: 20 }, { size: 2 }], 1, 0.15);
  assert.deepEqual(tight.flatMap((s) => s.groups).sort(), [0, 1, 2]);
});

test("packStacks: a big group still splits when the small groups set the row height by stacking", async () => {
  const { packStacks } = await import("../src/stackLayout.ts");
  // Commander, 53 creatures, 8 instants, 5 sorceries, 3 artifacts, 6 enchantments, 9 lands.
  const groups = [{ size: 1, whole: true }, { size: 53 }, { size: 8 }, { size: 5 }, { size: 3 }, { size: 6 }, { size: 9 }];
  const shape = (cols: number) => packStacks(groups, cols, 0.15).map((s) => `${s.groups.join("+")}${s.span > 1 ? `×${s.span}` : ""}`);
  // Seven columns: the creatures take three while the small types keep sharing columns.
  assert.deepEqual(shape(7), ["0", "1×3", "2+3", "4+5", "6"]);
  assert.deepEqual(shape(6), ["0", "1×2", "2+3", "4+5", "6"]);
});
