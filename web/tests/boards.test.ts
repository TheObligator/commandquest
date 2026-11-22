// Where a search result already is in the deck (src/pages/boards.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { inDeckParts, inDeckText } from "../src/pages/boards.ts";

test("one board: the count and the board", () => {
  assert.equal(inDeckText([{ board: "main", quantity: 1 }]), "1 in main deck");
  assert.equal(inDeckText([{ board: "maybe", quantity: 2 }]), "2 in considering");
  assert.equal(inDeckText([{ board: "side", quantity: 1 }]), "1 in sideboard");
  assert.equal(inDeckText([{ board: "commander", quantity: 1 }]), "Commander");
});

test("several boards: a short list, commander first", () => {
  assert.equal(inDeckText([{ board: "maybe", quantity: 1 }, { board: "main", quantity: 1 }]), "1 main · 1 considering");
});

test("the parts name each board, for coloring", () => {
  assert.deepEqual(inDeckParts([{ board: "maybe", quantity: 1 }, { board: "commander", quantity: 1 }]), [
    { board: "commander", text: "1 commander" },
    { board: "maybe", text: "1 considering" },
  ]);
});
