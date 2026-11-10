import { test } from "node:test";
import assert from "node:assert/strict";
import type { DeckCard } from "../convex/model/deckRules.ts";
import type { ScryCard } from "../src/scryfall.ts";
import { deckTokens, tokenArtMap, tokenIdentity, tokenIds } from "../src/tokens.ts";

// A tiny Scryfall: cards that make tokens, and the token printings.
const sc = (o: Partial<ScryCard> & { id: string; name: string }): ScryCard => ({ layout: "normal", cmc: 0, type_line: "", color_identity: [], set: "x", set_name: "X", collector_number: "1", rarity: "common", scryfall_uri: "", legalities: {}, ...o }) as ScryCard;
const parts = (...ids: string[]) => ids.map((id) => ({ id, component: "token", name: "t" }));
const db = new Map<string, ScryCard>([
  ["krenko", sc({ id: "krenko", name: "Krenko, Mob Boss", released_at: "2012-07-13", all_parts: parts("gob-m13") })],
  ["warren", sc({ id: "warren", name: "Goblin Instigator", released_at: "2023-01-01", all_parts: parts("gob-new") })],
  ["old", sc({ id: "old", name: "Beetleback Chief", released_at: "2009-01-01", all_parts: parts("gob-old") })],
  ["smith", sc({ id: "smith", name: "Goldspan Dragon", released_at: "2021-02-05", all_parts: parts("treasure-khm", "emblem-x") })],
  ["gob-m13", sc({ id: "gob-m13", name: "Goblin", type_line: "Token Creature — Goblin", colors: ["R"], power: "1", toughness: "1" })],
  ["gob-new", sc({ id: "gob-new", name: "Goblin", type_line: "Token Creature — Goblin", colors: ["R"], power: "1", toughness: "1" })],
  ["gob-old", sc({ id: "gob-old", name: "Goblin", type_line: "Token Creature — Goblin", colors: ["R"], power: "1", toughness: "1" })],
  ["treasure-khm", sc({ id: "treasure-khm", name: "Treasure", type_line: "Token Artifact — Treasure", colors: [] })],
  ["emblem-x", sc({ id: "emblem-x", name: "Someone Emblem", type_line: "Emblem — Someone", layout: "emblem" })],
]);
const card = (c: DeckCard) => db.get(c.scryfallId ?? "");
const token = (id: string) => db.get(id);
const d = (name: string, id: string, board: DeckCard["board"] = "main"): DeckCard => ({ name, quantity: 1, board, scryfallId: id });

test("the same token from different cards is one entry; identity is name, colors and P/T", () => {
  assert.equal(tokenIdentity({ name: "Goblin Token", colors: ["R"], power: "1", toughness: "1" }), "goblin|R|1/1");
  assert.equal(tokenIdentity({ name: "Treasure", colors: [] }), "treasure||-");
  const list = deckTokens([d("Goblin Instigator", "warren"), d("Beetleback Chief", "old"), d("Goldspan Dragon", "smith")], card, token);
  assert.deepEqual(list.map((t) => t.identity), ["goblin|R|1/1", "treasure||-"]);
  assert.equal(list[0].sources.length, 2);
});

test("default printing: the commander's token, else the newest card's", () => {
  const withCommander = deckTokens([d("Krenko, Mob Boss", "krenko", "commander"), d("Goblin Instigator", "warren"), d("Beetleback Chief", "old")], card, token);
  assert.equal(withCommander[0].defaultId, "gob-m13", "Krenko is the commander, so his Goblin wins over newer cards");
  const without = deckTokens([d("Beetleback Chief", "old"), d("Goblin Instigator", "warren")], card, token);
  assert.equal(without[0].defaultId, "gob-new", "otherwise the newest card's Goblin");
});

test("your pick for the deck wins, and the game map uses it", () => {
  const list = deckTokens([d("Goblin Instigator", "warren"), d("Goldspan Dragon", "smith")], card, token, { "goblin|R|1/1": "gob-old" });
  assert.equal(list[0].id, "gob-old");
  assert.equal(list[0].defaultId, "gob-new");
  assert.deepEqual(tokenArtMap(list), { "goblin|R|1/1": "gob-old", "treasure||-": "treasure-khm" });
});

test("emblems aren't tokens, and sideboard cards don't count", () => {
  const list = deckTokens([d("Goldspan Dragon", "smith"), d("Goblin Instigator", "warren", "side")], card, token);
  assert.deepEqual(list.map((t) => t.name), ["Treasure"]);
  assert.deepEqual(tokenIds([d("Goldspan Dragon", "smith")], card).sort(), ["emblem-x", "treasure-khm"]);
});
