import { test } from "node:test";
import assert from "node:assert/strict";
import type { DeckCard } from "../convex/model/deckRules.ts";
import type { ScryCard } from "../src/scryfall.ts";
import { categoryOf, deckCategories, deckTags, groupCards, isGroupBy, primaryType } from "../src/deckGroups.ts";

const data: Record<string, Partial<ScryCard>> = {
  "Sol Ring": { type_line: "Artifact", cmc: 1, colors: [], color_identity: [], rarity: "uncommon", set: "c21", set_name: "Commander 2021", released_at: "2021-04-23", artist: "Mike Bierek" },
  "Llanowar Elves": { type_line: "Creature — Elf Druid", cmc: 1, colors: ["G"], color_identity: ["G"], rarity: "common", set: "dom", set_name: "Dominaria", released_at: "2018-04-27", artist: "Chris Rahn" },
  "Counterspell": { type_line: "Instant", cmc: 2, colors: ["U"], color_identity: ["U"], rarity: "common", set: "dom", set_name: "Dominaria", released_at: "2018-04-27", artist: "Zack Stella" },
  "Fact or Fiction": { type_line: "Instant", cmc: 4, colors: ["U"], color_identity: ["U"], rarity: "uncommon", set: "c21", set_name: "Commander 2021", released_at: "2021-04-23" },
  "Forest": { type_line: "Basic Land — Forest", cmc: 0, colors: [], color_identity: ["G"], rarity: "common", set: "dom", set_name: "Dominaria", released_at: "2018-04-27", artist: "Jonas De Ro" },
  "Emeria's Call": {
    layout: "modal_dfc", cmc: 7, color_identity: ["W"], rarity: "mythic", set: "znr", set_name: "Zendikar Rising", released_at: "2020-09-25",
    card_faces: [{ name: "Emeria's Call", type_line: "Sorcery", mana_cost: "{4}{W}{W}{W}" }, { name: "Emeria, Shattered Skyclave", type_line: "Land" }] as ScryCard["card_faces"],
  },
  "Kenrith, the Returned King": { type_line: "Legendary Creature — Human Noble", cmc: 5, colors: ["R"], color_identity: ["W", "U", "B", "R", "G"], rarity: "mythic", set: "eld", set_name: "Throne of Eldraine", released_at: "2019-10-04" },
};
const card = (name: string, tags?: string[]): DeckCard => ({ name, quantity: 1, board: "main", ...(tags ? { tags } : {}) });
const cardOf = (c: DeckCard) => (data[c.name] ? ({ name: c.name, ...data[c.name] } as ScryCard) : undefined);
const deck = [card("Sol Ring", ["Ramp"]), card("Llanowar Elves", ["Ramp", "Creatures"]), card("Counterspell", ["Interaction"]), card("Fact or Fiction"), card("Forest"), card("Emeria's Call"), card("Kenrith, the Returned King"), card("Not Loaded Yet")];
const shape = (by: Parameters<typeof groupCards>[1]) => groupCards(deck, by, cardOf).map((g) => `${g.label}: ${g.cards.map((c) => c.name).join(", ")}`);

test("grouped by type, in type order, cheapest first", () => {
  assert.deepEqual(shape("type"), [
    "Creature: Llanowar Elves, Kenrith, the Returned King",
    "Instant: Counterspell, Fact or Fiction",
    "Sorcery: Emeria's Call",
    "Artifact: Sol Ring",
    "Land: Forest",
    "Loading…: Not Loaded Yet",
  ]);
  assert.equal(primaryType(cardOf(card("Emeria's Call"))), "Sorcery");
});

test("tags: a card shows under each of its tags; Type & tag puts untagged cards under their type", () => {
  assert.deepEqual(shape("tag"), ["Creatures: Llanowar Elves", "Interaction: Counterspell", "Ramp: Llanowar Elves, Sol Ring", "Untagged: Forest, Not Loaded Yet, Fact or Fiction, Kenrith, the Returned King, Emeria's Call"]);
  assert.deepEqual(shape("typeTag").slice(0, 4), ["Creatures: Llanowar Elves", "Interaction: Counterspell", "Ramp: Llanowar Elves, Sol Ring", "Creature: Kenrith, the Returned King"]);
  assert.deepEqual(deckTags(deck), ["Ramp", "Creatures", "Interaction"]);
});

test("colors, identity, mana value, rarity, set, subtype, artist", () => {
  assert.deepEqual(shape("color").slice(0, 5), ["White: Emeria's Call", "Blue: Counterspell, Fact or Fiction", "Red: Kenrith, the Returned King", "Green: Llanowar Elves", "Colorless: Sol Ring"]);
  assert.ok(shape("color").includes("Lands: Forest"));
  assert.deepEqual(shape("identity").slice(0, 2), ["Colorless: Sol Ring", "White: Emeria's Call"]);
  assert.ok(shape("identity").includes("White / Blue / Black / Red / Green: Kenrith, the Returned King"));
  assert.deepEqual(shape("manaValue").slice(0, 3), ["1 mana: Llanowar Elves, Sol Ring", "2 mana: Counterspell", "4 mana: Fact or Fiction"]);
  assert.deepEqual(shape("rarity").slice(0, 2), ["Mythic: Kenrith, the Returned King, Emeria's Call", "Uncommon: Sol Ring, Fact or Fiction"]);
  assert.deepEqual(shape("set")[0], "Commander 2021: Sol Ring, Fact or Fiction");
  assert.deepEqual(shape("subtype").slice(0, 2), ["Elf: Llanowar Elves", "Forest: Forest"]);
  assert.ok(shape("artist").includes("Unknown artist: Fact or Fiction, Kenrith, the Returned King, Emeria's Call"));
  assert.deepEqual(shape("none").length, 1);
});

const fits: Record<string, string[]> = { "Sol Ring": ["Ramp"], "Llanowar Elves": ["Ramp"], Counterspell: ["Counterspells", "Removal"], "Fact or Fiction": ["Draw", "Mill"], Forest: ["Ramp"] };
const auto = (c: ScryCard) => fits[c.name] ?? [];
const byCategory = (cards: DeckCard[], a?: typeof auto) => groupCards(cards, "category", cardOf, a).map((g) => `${g.label}: ${g.cards.map((c) => c.name).join(", ")}`);

test("category: each card once, under its best category; without one, under its type; lands under Land", () => {
  assert.deepEqual(byCategory(deck, auto), [
    "Counterspells: Counterspell",
    "Draw: Fact or Fiction",
    "Ramp: Llanowar Elves, Sol Ring",
    "Creature: Kenrith, the Returned King",
    "Sorcery: Emeria's Call",
    "Land: Forest",
    "Loading…: Not Loaded Yet",
  ]);
});

test("category: the deck's own category wins, ignoring case, even for lands and cards still loading", () => {
  const own = (name: string, category: string): DeckCard => ({ ...card(name), category });
  const cards = [own("Fact or Fiction", "ramp"), card("Sol Ring"), own("Forest", "Utility lands"), own("Not Loaded Yet", "Win condition"), own("Counterspell", "creature"), card("Kenrith, the Returned King")];
  assert.deepEqual(byCategory(cards, auto), [
    "ramp: Sol Ring, Fact or Fiction",
    "Utility lands: Forest",
    "Win condition: Not Loaded Yet",
    "Creature: Counterspell, Kenrith, the Returned King",
  ]);
  assert.deepEqual(deckCategories([...cards, own("Sol Ring", "RAMP")]), ["ramp", "Utility lands", "Win condition", "creature"]);
  assert.equal(categoryOf(card("Forest"), cardOf(card("Forest")), auto), undefined);
});

test("category: cards wait while the automatic categories load, except lands and the player's own", () => {
  assert.deepEqual(byCategory([{ ...card("Sol Ring"), category: "Rocks" }, card("Forest"), card("Counterspell")]), ["Rocks: Sol Ring", "Land: Forest", "Loading…: Counterspell"]);
});

test("saved groupings are checked", () => {
  assert.ok(isGroupBy("category"));
  assert.ok(!isGroupBy("nonsense") && !isGroupBy(undefined));
});
