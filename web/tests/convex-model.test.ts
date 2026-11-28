// Pure logic behind the Convex functions (validation and deck-site parsers). The functions
// themselves are smoke-tested against a local Convex deployment; see docs/web-dev.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBracket, colorCards, DeckError, MAX_QUANTITY, summarize, validateDeck, withCardsAdded, type DeckCard } from "../convex/model/deckRules.ts";
import { archidektCategories, deckSource, parseArchidekt, parseMoxfield, shareKeyFromLink } from "../convex/model/importers.ts";
import { cleanFolderName, FolderError, MAX_FOLDER_NAME } from "../convex/model/folderRules.ts";

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
  bad({ name: "x", cards: [], extraColor: "purple" }, /Unknown color/);
});

test("validateDeck keeps a deck's extra color, and clears it when it's dropped", () => {
  assert.equal(validateDeck({ name: "x", cards: [], extraColor: "G" }).extraColor, "G");
  const d = validateDeck({ name: "x", cards: [] });
  assert.ok("extraColor" in d && d.extraColor === undefined);
});

test("validateDeck checks the bracket and tidies its tags", () => {
  const d = validateDeck({ name: "x", cards: [], bracket: 3, bracketTags: [" Fast mana ", "fast  MANA", "", "Two-card combo"] });
  assert.equal(d.bracket, 3);
  assert.deepEqual(d.bracketTags, ["Fast mana", "Two-card combo"]);
  const cleared = validateDeck({ name: "x", cards: [], bracketTags: [] });
  assert.ok("bracket" in cleared && cleared.bracket === undefined);
  assert.ok("bracketTags" in cleared && cleared.bracketTags === undefined);
  assert.equal(validateDeck({ name: "x", cards: [], bracketTags: ["a".repeat(80)] }).bracketTags![0].length, 40);
  for (const bracket of [0, 6, 2.5]) assert.throws(() => validateDeck({ name: "x", cards: [], bracket }), DeckError);
  assert.throws(() => validateDeck({ name: "x", cards: [], bracketTags: Array.from({ length: 41 }, (_, i) => `t${i}`) }), DeckError);
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

test("shareKeyFromLink reads CommandQuest share links and bare keys", () => {
  assert.equal(shareKeyFromLink("https://commandquest.app/#/d/aB3dE5gH7k"), "aB3dE5gH7k");
  assert.equal(shareKeyFromLink("  https://staging.commandquest.app/#/d/aB3dE5gH7k/ "), "aB3dE5gH7k");
  assert.equal(shareKeyFromLink("http://localhost:5173/?x=1#/d/aB3dE5gH7k?tab=list"), "aB3dE5gH7k");
  assert.equal(shareKeyFromLink("aB3dE5gH7k"), "aB3dE5gH7k");
  assert.equal(shareKeyFromLink("https://commandquest.app/#/d/short"), null);
  assert.equal(shareKeyFromLink("https://commandquest.app/#/decks/aB3dE5gH7k"), null);
  assert.equal(shareKeyFromLink("https://moxfield.com/decks/aB3dE5gH7k"), null);
  assert.equal(shareKeyFromLink("aB3dE5gH70"), null); // 0 isn't in share keys
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

test("cleanFolderName trims, collapses spaces and rejects blanks, long names and repeats", () => {
  assert.equal(cleanFolderName("  Casual   decks "), "Casual decks");
  assert.equal(cleanFolderName("Testing", ["Casual"]), "Testing");
  const bad = (name: string, taken: string[], msg: RegExp) => assert.throws(() => cleanFolderName(name, taken), (e) => e instanceof FolderError && msg.test(e.message));
  bad("   ", [], /1-50 characters/);
  bad("x".repeat(MAX_FOLDER_NAME + 1), [], /1-50 characters/);
  bad("casual", ["Casual"], /already have a folder called "casual"/);
});

test("validateDeck tidies a card's category, and drops a blank one", () => {
  const d = validateDeck({ name: "x", cards: [{ name: "Sol Ring", quantity: 1, board: "main", category: "  Mana   rocks " }, { name: "Opt", quantity: 1, board: "main", category: "  " }] });
  assert.deepEqual(d.cards.map((c) => c.category), ["Mana rocks", undefined]);
  assert.ok(!("category" in d.cards[1]));
});

test("parseArchidekt keeps the deck's own categories: the first is the card's, others are tags", () => {
  const d = parseArchidekt({
    name: "x", deckFormat: 3,
    categories: [{ name: "Maybeboard", includedInDeck: false }, { name: "Cuts", includedInDeck: false }],
    cards: [
      { quantity: 1, categories: ["Commander", "Draw"], card: { oracleCard: { name: "A" } } },
      { quantity: 1, categories: ["Mill", "Win condition", "mill"], card: { oracleCard: { name: "B" } } },
      { quantity: 1, categories: ["Creature"], card: { oracleCard: { name: "C" } } },
      { quantity: 1, categories: ["Land", "Utility"], card: { oracleCard: { name: "D" } } },
      { quantity: 1, categories: ["Cuts", "Ramp"], card: { oracleCard: { name: "E" } } },
      { quantity: 1, categories: ["Ramp", "Cuts"], card: { oracleCard: { name: "F" } } },
      { quantity: 1, categories: null, card: { oracleCard: { name: "G" } } },
    ],
  });
  const of = (n: string) => d.cards.filter((c) => c.name === n).map((c) => [c.board, c.category, c.tags])[0];
  assert.deepEqual(of("A"), ["commander", "Draw", undefined]);
  assert.deepEqual(of("B"), ["main", "Mill", ["Win condition"]]);
  assert.deepEqual(of("C"), ["main", undefined, undefined]);
  assert.deepEqual(of("D"), ["main", "Utility", undefined]);
  assert.deepEqual(of("E"), ["maybe", "Ramp", undefined]);
  assert.deepEqual(of("F"), ["main", "Ramp", undefined]);
  assert.deepEqual(of("G"), ["main", undefined, undefined]);
  assert.deepEqual(archidektCategories([]), {});
});

test("checkBracket takes 1 to 5, and nothing as none", () => {
  for (const b of [1, 2, 3, 4, 5]) assert.equal(checkBracket(b), b);
  assert.equal(checkBracket(null), undefined);
  assert.equal(checkBracket(undefined), undefined);
  for (const b of [0, 6, 2.5, NaN]) assert.throws(() => checkBracket(b), DeckError);
});

test("colorCards: the commanders, or the main deck without any", () => {
  const ring = { name: "Sol Ring", quantity: 1, board: "main" as const, tags: ["Ramp"] };
  const maybe = { name: "Shock", quantity: 1, board: "maybe" as const };
  const iroh = { name: "Iroh, Grand Lotus", quantity: 1, board: "commander" as const, set: "tla" };
  assert.deepEqual(colorCards([ring, maybe, iroh]).map((c) => [c.name, c.set]), [["Iroh, Grand Lotus", "tla"]]);
  assert.deepEqual(colorCards([ring, maybe]).map((c) => c.name), ["Sol Ring"]);
  assert.ok(!("tags" in colorCards([ring])[0]));
});

test("withCardsAdded merges copies onto the same board and keeps new cards' printing and tags", () => {
  const deck: DeckCard[] = [{ name: "Sol Ring", quantity: 1, board: "main", set: "c21" }, { name: "Forest", quantity: 248, board: "main" }];
  const out = withCardsAdded(deck, [
    { name: "sol ring", quantity: 2, board: "main", set: "lea" },
    { name: "Forest", quantity: 5, board: "main" },
    { name: "Counterspell", quantity: 1, board: "side", set: "ice", tags: ["Interaction"] },
  ]);
  assert.deepEqual(out, [
    { name: "Sol Ring", quantity: 3, board: "main", set: "c21" },
    { name: "Forest", quantity: MAX_QUANTITY, board: "main" },
    { name: "Counterspell", quantity: 1, board: "side", set: "ice", tags: ["Interaction"] },
  ]);
  assert.equal(deck[0].quantity, 1, "the deck it was given isn't changed");
  assert.deepEqual(withCardsAdded([], [{ name: "Island", quantity: 1, board: "maybe" }], true), [{ name: "Island", quantity: 1, board: "main" }]);
});
