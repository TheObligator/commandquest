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
  assert.deepEqual(v, { id: 1, owner: "me", controller: "me", zone: "battlefield", hidden: true, faceDown: true, types: ["Creature"], power: 2, toughness: 2, tapped: true, counters: { "+1/+1": 1 } });
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
  assert.deepEqual(lands.map((p) => p.cards.map((c) => c.id)), [[1], [5], [6]]);
});

test("moving cards to another row and position, and pruning cards that left", () => {
  const cards = [card(1, "A"), card(2, "B"), card(3, "Sol Ring", { types: ["Artifact"] })].map((c) => redact(c, "me"));
  let arr = moveCards(cards, {}, [3], 0, 2); // the artifact into the creature row, before B
  assert.deepEqual(arrange(cards, arr)[0].map((p) => p.cards[0].id), [1, 3, 2]);
  assert.equal(arrange(cards, arr)[1].length, 0);
  arr = moveCards(cards, arr, [1], 2); // A to the end of the lands row
  assert.deepEqual(arrange(cards, arr)[2].map((p) => p.cards[0].id), [1]);
  assert.deepEqual(Object.keys(prune(arr, cards.slice(1))).map(Number).sort(), [2, 3]);
});
