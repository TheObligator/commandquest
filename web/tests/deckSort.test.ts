// The deck list's sorting and colors (src/deckSort.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SORT, deckColors, pickSort, sortDecks, sortFolders, type DeckSort, type SortableDeck } from "../src/deckSort.ts";

const deck = (name: string, d: Partial<SortableDeck> = {}): SortableDeck => ({ name, format: "commander", cardCount: 100, updatedAt: 0, ...d });
const names = (decks: SortableDeck[], key: DeckSort["key"], dir: DeckSort["dir"]) => sortDecks(decks, { key, dir }).map((d) => d.name);

test("choosing a sort: newest and biggest first, the rest from A; again reverses it", () => {
  assert.deepEqual(pickSort(DEFAULT_SORT, "name"), { key: "name", dir: "asc" });
  assert.deepEqual(pickSort({ key: "name", dir: "asc" }, "name"), { key: "name", dir: "desc" });
  assert.deepEqual(pickSort({ key: "name", dir: "asc" }, "updated"), { key: "updated", dir: "desc" });
  assert.deepEqual(pickSort({ key: "name", dir: "asc" }, "cards"), { key: "cards", dir: "desc" });
});

test("by name, ignoring case and counting numbers", () => {
  const decks = [deck("deck 10"), deck("Bolg"), deck("deck 2"), deck("arna")];
  assert.deepEqual(names(decks, "name", "asc"), ["arna", "Bolg", "deck 2", "deck 10"]);
  assert.deepEqual(names(decks, "name", "desc"), ["deck 10", "deck 2", "Bolg", "arna"]);
});

test("by colors: fewest first, then WUBRG; unknown last either way", () => {
  const decks = [deck("?"), deck("WU", { colors: "WU" }), deck("G", { colors: "G" }), deck("none", { colors: "" }), deck("UB", { colors: "UB" }), deck("WB", { colors: "WB" }), deck("W", { colors: "W" })];
  assert.deepEqual(names(decks, "colors", "asc"), ["none", "W", "G", "WU", "WB", "UB", "?"]);
  assert.deepEqual(names(decks, "colors", "desc"), ["UB", "WB", "WU", "G", "W", "none", "?"]);
});

test("by format, then bracket; no bracket last", () => {
  const decks = [deck("m", { format: "modern" }), deck("none"), deck("b3", { bracket: 3 }), deck("b2", { bracket: 2 })];
  assert.deepEqual(names(decks, "format", "asc"), ["b2", "b3", "none", "m"]);
  assert.deepEqual(names(decks, "format", "desc"), ["m", "b3", "b2", "none"]);
});

test("by cards and by date, ties by name", () => {
  const decks = [deck("b", { updatedAt: 5, cardCount: 60 }), deck("a", { updatedAt: 5 }), deck("c", { updatedAt: 9 })];
  assert.deepEqual(names(decks, "updated", "desc"), ["c", "a", "b"]);
  assert.deepEqual(names(decks, "updated", "asc"), ["a", "b", "c"]);
  assert.deepEqual(names(decks, "cards", "asc"), ["b", "a", "c"]);
});

test("sorting leaves the list it was given alone", () => {
  const decks = [deck("b"), deck("a")];
  sortDecks(decks, { key: "name", dir: "asc" });
  assert.equal(decks[0].name, "b");
});

test("folders: by name, or by their newest deck with empty ones last", () => {
  const folders = [{ name: "Old", updatedAt: 1 }, { name: "Empty" }, { name: "New", updatedAt: 9 }];
  const order = (key: DeckSort["key"], dir: DeckSort["dir"]) => sortFolders(folders, { key, dir }).map((f) => f.name);
  assert.deepEqual(order("updated", "desc"), ["New", "Old", "Empty"]);
  assert.deepEqual(order("updated", "asc"), ["Old", "New", "Empty"]);
  assert.deepEqual(order("name", "desc"), ["Old", "New", "Empty"]);
  assert.deepEqual(order("colors", "desc"), ["Empty", "New", "Old"]);
});

test("a deck's colors", () => {
  assert.equal(deckColors([["G", "W"], ["U"]], true), "WUG");
  assert.equal(deckColors([[]], true), "");
  assert.equal(deckColors([["R"]], true, "W"), "WR");
  // A commander that isn't known could add any color; a card in a list can't be told either, but the rest still show.
  assert.equal(deckColors([["R"], undefined], true), undefined);
  assert.equal(deckColors([["R"], undefined], false), "R");
  assert.equal(deckColors([undefined], false), undefined);
  assert.equal(deckColors([], false), undefined);
});
