// Pure logic behind the Convex functions (validation and deck-site parsers). The functions
// themselves are smoke-tested against a local Convex deployment; see docs/web-dev.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DeckError, summarize, validateDeck } from "../convex/model/deckRules.ts";
import { deckSource, parseArchidekt, parseMoxfield } from "../convex/model/importers.ts";

test("validateDeck trims, defaults the format and board, and clips printing fields", () => {
  const d = validateDeck({ name: "  Atraxa  ", cards: [{ name: " Sol Ring ", quantity: 1, board: "main", set: "  c21 ", collectorNumber: "" }] });
  assert.equal(d.name, "Atraxa");
  assert.equal(d.format, "commander");
  assert.deepEqual(d.cards, [{ name: "Sol Ring", quantity: 1, board: "main", set: "c21" }]);
});

test("validateDeck rejects bad input with user-facing messages", () => {
  const bad = (input: Parameters<typeof validateDeck>[0], msg: RegExp) => assert.throws(() => validateDeck(input), (e) => e instanceof DeckError && msg.test(e.message));
  bad({ name: "", cards: [] }, /Deck names/);
  bad({ name: "x".repeat(101), cards: [] }, /Deck names/);
  bad({ name: "x", format: "Not A Format!", cards: [] }, /Unknown format/);
  bad({ name: "x", cards: [{ name: "Sol Ring", quantity: 0, board: "main" }] }, /Bad quantity/);
  bad({ name: "x", cards: [{ name: "Sol Ring", quantity: 1.5, board: "main" }] }, /Bad quantity/);
  bad({ name: "x", cards: [{ name: "Sol Ring", quantity: 1, board: "graveyard" as never }] }, /Unknown board/);
  bad({ name: "x", cards: [{ name: "Sol Ring", quantity: 1, board: "main", scryfallId: "nope" }] }, /Bad Scryfall id/);
});

test("summarize counts main + commander and picks the commander's art", () => {
  const s = summarize([
    { name: "Atraxa", quantity: 1, board: "commander", scryfallId: "d0d33d52-3d28-4635-b985-51e126289259" },
    { name: "Forest", quantity: 10, board: "main" },
    { name: "Doubling Season", quantity: 1, board: "maybe" },
    { name: "Pyroblast", quantity: 2, board: "side" },
  ]);
  assert.deepEqual(s, { cardCount: 11, commanders: ["Atraxa"], coverScryfallId: "d0d33d52-3d28-4635-b985-51e126289259" });
});

test("deckSource only accepts Moxfield and Archidekt deck links", () => {
  assert.equal(deckSource("https://moxfield.com/decks/abc_DEF-1")?.apiUrl, "https://api2.moxfield.com/v3/decks/all/abc_DEF-1");
  assert.equal(deckSource("https://www.archidekt.com/decks/123/name")?.apiUrl, "https://archidekt.com/api/decks/123/");
  assert.equal(deckSource("http://169.254.169.254/latest"), null);
  assert.equal(deckSource("https://moxfield.com.evil.example/decks/x"), null);
});

test("parseMoxfield (v3): boards, printings, unknown formats become other", () => {
  const d = parseMoxfield({
    name: "Test Deck", format: "none", boards: {
      mainboard: { cards: { a: { quantity: 1, card: { name: "Sol Ring", scryfall_id: "aaaaaaaa-0000-0000-0000-000000000000", set: "c21", cn: "263" } }, b: { quantity: 30, card: { name: "Island" } } } },
      commanders: { cards: { c: { quantity: 1, card: { name: "Talrand, Sky Summoner" } } } },
      tokens: { cards: { t: { quantity: 1, card: { name: "Drake", scryfall_id: "dddddddd-0000-0000-0000-000000000000", set: "tm19", cn: "4" } } } },
    },
  });
  assert.equal(d.format, "other");
  assert.deepEqual(d.cards.map((c) => [c.name, c.board]), [["Talrand, Sky Summoner", "commander"], ["Island", "main"], ["Sol Ring", "main"]]);
  assert.equal(d.cards[2].collectorNumber, "263");
  assert.deepEqual(d.tokens, [{ name: "Drake", scryfallId: "dddddddd-0000-0000-0000-000000000000", set: "tm19", collectorNumber: "4" }]);
});

test("parseArchidekt: commander, excluded categories, formats", () => {
  const d = parseArchidekt({
    name: "Fun With Fungus", deckFormat: 3,
    categories: [{ name: "Commander", includedInDeck: true }, { name: "Maybeboard", includedInDeck: false }, { name: "Sideboard", includedInDeck: false }],
    cards: [
      { quantity: 1, categories: ["Commander"], card: { uid: "92b0be6d-9183-4938-b7a1-ae7f04ba78a0", collectorNumber: "227", edition: { editioncode: "tsp" }, oracleCard: { name: "Thelon of Havenwood" } } },
      { quantity: 2, categories: ["Maybeboard"], card: { oracleCard: { name: "Thallid" } } },
      { quantity: 1, categories: ["Sideboard"], card: { oracleCard: { name: "Naturalize" } } },
      { quantity: 12, categories: [], card: { oracleCard: { name: "Forest" } } },
      { quantity: 1, categories: ["Tokens"], card: { uid: "eeeeeeee-0000-0000-0000-000000000000", collectorNumber: "12", edition: { editioncode: "ttsp" }, oracleCard: { name: "Saproling", layout: "token", types: ["Creature"] } } },
    ],
  });
  assert.equal(d.format, "commander");
  assert.deepEqual(d.cards.map((c) => [c.name, c.board]), [["Thelon of Havenwood", "commander"], ["Forest", "main"], ["Naturalize", "side"], ["Thallid", "maybe"]]);
  assert.equal(d.cards[0].set, "tsp");
  assert.deepEqual(d.tokens, [{ name: "Saproling", scryfallId: "eeeeeeee-0000-0000-0000-000000000000", set: "ttsp", collectorNumber: "12" }]);
});
