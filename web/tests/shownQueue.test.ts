import { test } from "node:test";
import assert from "node:assert/strict";
import { addShown, type LiveShown } from "../src/game/shownQueue.ts";
import type { CardView } from "../src/game/view.ts";

const card = (id: number, name: string) => ({ id, name }) as CardView;

test("reveals from one stack item share a window, a section per player", () => {
  let q: LiveShown[] = [];
  q = addShown(q, { title: "K - Looking at card from your library", owner: "a", zone: "library", group: "s7", source: "Ambassador K'Ehleyr", cards: [card(1, "Counterspell")] }, 1);
  q = addShown(q, { title: "K - Revealing card from Bea's library", owner: "b", zone: "library", group: "s7", source: "Ambassador K'Ehleyr", cards: [card(2, "Cultivate")] }, 2);
  q = addShown(q, { title: "K - Revealing card from Cal's library", owner: "c", zone: "library", group: "s7", source: "Ambassador K'Ehleyr", cards: [card(3, "Forest")] }, 3);
  assert.equal(q.length, 1);
  assert.equal(q[0].title, "Ambassador K'Ehleyr — revealed");
  assert.deepEqual(q[0].sections.map((s) => [s.owner, s.cards.map((c) => c.name)]), [["a", ["Counterspell"]], ["b", ["Cultivate"]], ["c", ["Forest"]]]);
});

test("a card seen twice in one effect shows once; other groups get their own window", () => {
  let q: LiveShown[] = [];
  q = addShown(q, { title: "peek", owner: "b", group: "s1", source: "X", cards: [card(2, "Cultivate")] }, 1);
  q = addShown(q, { title: "reveal", owner: "b", group: "s1", source: "X", cards: [card(2, "Cultivate")] }, 2);
  q = addShown(q, { title: "hand", owner: "c", group: "s2", source: "Y", cards: [card(5, "Sol Ring")] }, 3);
  q = addShown(q, { title: "no group", owner: "c", cards: [card(6, "Island")] }, 4);
  assert.equal(q.length, 3);
  assert.equal(q[0].title, "peek");
  assert.deepEqual(q[0].sections.map((s) => s.cards.length), [1]);
  assert.deepEqual(q.map((s) => s.n), [1, 3, 4]);
});

test("an empty reveal keeps its note", () => {
  const q = addShown([], { title: "Look", owner: "a", note: "There are no cards in your library", cards: [] }, 1);
  assert.equal(q[0].sections[0].note, "There are no cards in your library");
});
