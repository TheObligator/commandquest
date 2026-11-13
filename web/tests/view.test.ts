import { test } from "node:test";
import assert from "node:assert/strict";
import { arrange, moveCards, prune, redact, viewFor, type CardState, type GameState } from "../src/game/view.ts";

const card = (id: number, name: string, extra: Partial<CardState> = {}): CardState => ({
  id, name, owner: "me", controller: "me", zone: "battlefield", types: ["Creature"], ...extra,
});

function game(cards: CardState[]): GameState {
  const player = (id: string) => ({ id, name: id, color: "#fff", life: 40, poison: 0, commanderDamage: {}, commanderCasts: 0 });
  return { players: [player("me"), player("o1"), player("o2")], cards, stack: [], turn: 1, active: "me", step: "MAIN1", log: [] };
}

test("hands and libraries: only counts for other players, your own hand in full", () => {
  const g = game([
    card(1, "Sol Ring", { zone: "hand", types: ["Artifact"] }),
    card(2, "Counterspell", { zone: "hand", owner: "o1", controller: "o1", types: ["Instant"] }),
    card(3, "Island", { zone: "library", owner: "o1", controller: "o1", types: ["Land"] }),
  ]);
  const mine = viewFor(g, "me");
  assert.deepEqual(mine.players.map((p) => p.id), ["me", "o1", "o2"]);
  assert.equal(mine.players[0].hand[0].name, "Sol Ring");
  assert.equal(mine.players[1].handCount, 1);
  assert.equal(mine.players[1].hand.length, 0);
  assert.equal(mine.players[1].libraryCount, 1);
  assert.ok(!JSON.stringify(mine).includes("Counterspell"));
  assert.ok(!JSON.stringify(mine).includes("Island"));
  // Seen from o1, players start with o1 and keep turn order.
  assert.deepEqual(viewFor(g, "o1").players.map((p) => p.id), ["o1", "o2", "me"]);
});

test("face-down exile: everyone sees it's there and who may look, only they see the face", () => {
  // Gonti (o1) exiled the top of my library face down: only o1 may look at it.
  const g = game([card(1, "Rhystic Study", { zone: "exile", types: ["Enchantment"], faceDown: true, visibleTo: ["o1"] })]);
  const mine = viewFor(g, "me").players[0].exile[0];
  assert.equal(mine.hidden, true);
  assert.equal(mine.faceDown, true);
  assert.equal(mine.name, undefined);
  assert.deepEqual(mine.visibleTo, ["o1"]);
  assert.ok(!JSON.stringify(viewFor(g, "o2")).includes("Rhystic"));
  const theirs = viewFor(g, "o1").players.find((p) => p.id === "me")!.exile[0];
  assert.equal(theirs.name, "Rhystic Study");
  assert.equal(theirs.hidden, undefined);
});

test("face-down permanents show as 2/2 creatures with their public state only", () => {
  const v = redact(card(1, "Den Protector", { faceDown: true, tapped: true, counters: { "+1/+1": 1 } }), "o1");
  assert.deepEqual(v, { id: 1, owner: "me", controller: "me", zone: "battlefield", hidden: true, faceDown: true, types: ["Creature"], power: 3, toughness: 3, tapped: true, counters: { "+1/+1": 1 } });
});

test("battlefield rows: creatures, other permanents, lands; identical cards pile up", () => {
  const cards = [
    card(1, "Forest", { types: ["Land"] }),
    card(2, "Goblin", { token: true }),
    card(3, "Sol Ring", { types: ["Artifact"] }),
    card(4, "Goblin", { token: true }),
    card(5, "Forest", { types: ["Land"], tapped: true }),
    card(6, "Forest", { types: ["Land"] }),
  ].map((c) => redact(c, "me"));
  const [creatures, others, lands] = arrange(cards, {});
  assert.deepEqual(creatures.map((p) => p.cards.map((c) => c.id)), [[2, 4]]);
  assert.deepEqual(others.map((p) => p.cards.map((c) => c.id)), [[3]]);
  // A tapped Forest isn't piled with untapped ones.
  assert.deepEqual(lands.map((p) => p.cards.map((c) => c.id)), [[1, 6], [5]]);
});

test("moving cards to any cell; a taken cell swaps; new cards fill the first free cell", () => {
  const cards = [card(1, "A"), card(2, "B"), card(3, "Sol Ring", { types: ["Artifact"] })].map((c) => redact(c, "me"));
  const ids = (r: ReturnType<typeof arrange>[number]) => r.map((p) => [p.cards[0].id, p.col]);
  assert.deepEqual(ids(arrange(cards, {})[0]), [[1, 0], [2, 1]]);
  let arr = moveCards(cards, {}, [3], 0, 4); // the artifact into the creature row, with a gap
  assert.deepEqual(ids(arrange(cards, arr)[0]), [[1, 0], [2, 1], [3, 4]]);
  assert.equal(arrange(cards, arr)[1].length, 0);
  arr = moveCards(cards, arr, [3], 0, 0); // onto A: they swap
  assert.deepEqual(ids(arrange(cards, arr)[0]), [[3, 0], [2, 1], [1, 4]]);
  // A new creature takes the first free cell, without moving anything.
  const more = [...cards, redact(card(4, "C"), "me")];
  assert.deepEqual(ids(arrange(more, arr)[0]), [[3, 0], [2, 1], [4, 2], [1, 4]]);
  // Played from hand onto a taken cell: the card there moves right to the next free cell.
  arr = moveCards(more, arr, [9], 0, 1);
  assert.deepEqual(arr[9], { row: 0, col: 1 });
  assert.deepEqual(arr[2], { row: 0, col: 3 });
  assert.deepEqual(Object.keys(prune(arr, cards.slice(1), [9])).map(Number).sort(), [2, 3, 9]);
});

test("a new copy of a card joins its pile wherever that pile was moved", () => {
  const goblin = (id: number) => redact(card(id, "Goblin", { token: true }), "me");
  const arr = moveCards([goblin(1)], {}, [1], 0, 3);
  const [row] = arrange([goblin(1), goblin(2)], arr);
  assert.deepEqual(row.map((p) => [p.col, p.cards.map((c) => c.id)]), [[3, [1, 2]]]);
});

test("with a width, cards are centered; new cards join an arranged row near the middle", () => {
  const cards = [card(1, "A"), card(2, "B"), card(3, "Forest", { types: ["Land"] })].map((c) => redact(c, "me"));
  const ids = (r: ReturnType<typeof arrange>[number]) => r.map((p) => [p.cards[0].id, p.col]);
  // 9 columns: two creatures in the middle, the land under them.
  const [creatures, , lands] = arrange(cards, {}, 9);
  assert.deepEqual(ids(creatures), [[1, 3], [2, 4]]);
  assert.deepEqual(ids(lands), [[3, 4]]);
  // Dragging pins the cards where they show; new creatures go beside them, one each side.
  const arr = moveCards(cards, {}, [3], 2, 4, 9);
  assert.deepEqual(arr[1], { row: 0, col: 3 });
  const more = [...cards, redact(card(4, "C"), "me"), redact(card(5, "D"), "me")];
  assert.deepEqual(ids(arrange(more, arr, 9)[0]), [[5, 2], [1, 3], [2, 4], [4, 5]]);
});
