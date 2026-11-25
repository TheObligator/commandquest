import { test } from "node:test";
import assert from "node:assert/strict";
import { DeckError, summarize, type DeckCard } from "../convex/model/deckRules.ts";
import { inPackage, MAX_PACKAGE_CARDS, validatePackage, withCard } from "../convex/model/packageRules.ts";
import { CARD_LIST, formatLabel, hasCommander } from "../src/deckFormats.ts";
import { copiesIn, packageColors, planPackage, type DeckFor, type PackageFit } from "../src/packages.ts";

const data: Record<string, { id: string; type?: string; text?: string; cost?: string; banned?: boolean }> = {
  "Tatyova, Benthic Druid": { id: "GU", type: "Legendary Creature — Merfolk Druid" },
  "Tolabow, Loch Rascal": { id: "U", type: "Legendary Creature" },
  "Sol Ring": { id: "", type: "Artifact" },
  Cultivate: { id: "G", type: "Sorcery" },
  Counterspell: { id: "U", type: "Instant" },
  "Dark Ritual": { id: "B", type: "Instant" },
  "Wrath of God": { id: "W", type: "Sorcery" },
  "Primeval Titan": { id: "G", type: "Creature", banned: true },
  Forest: { id: "G", type: "Basic Land — Forest" },
  "Persistent Petitioners": { id: "U", type: "Creature", text: "A deck can have any number of cards named Persistent Petitioners." },
  "Murderous Redcap": { id: "BR", type: "Creature", cost: "{2}{B/R}{B/R}" },
};
const cardOf = (c: DeckCard) => {
  const d = data[c.name];
  return d && {
    name: c.name, layout: "normal", type_line: d.type ?? "", mana_cost: d.cost ?? "", oracle_text: d.text ?? "", keywords: [],
    color_identity: [...d.id], legalities: { commander: d.banned ? "banned" : "legal", modern: "legal", vintage: "legal" },
  };
};
const card = (name: string, quantity = 1, board: DeckCard["board"] = "main"): DeckCard => ({ name, quantity, board });
const deck = (format: string, ...cards: DeckCard[]): DeckFor => ({ format, cards });
const plan = (pkg: DeckCard[], d: DeckFor, board?: DeckCard["board"]) => planPackage(pkg, d, cardOf as never, board).map((e) => [e.card.name, e.fit, e.copies] as [string, PackageFit, number]);
const tatyova = card("Tatyova, Benthic Druid", 1, "commander");

test("a package is checked against the commander's colors, the deck and the format", () => {
  assert.deepEqual(plan([card("Sol Ring"), card("Cultivate"), card("Dark Ritual"), card("Primeval Titan"), card("Notacard")], deck("commander", tatyova, card("Sol Ring"))), [
    ["Sol Ring", "have", 0],
    ["Cultivate", "fits", 1],
    ["Dark Ritual", "off", 1],
    ["Primeval Titan", "illegal", 1],
    ["Notacard", "unknown", 1],
  ]);
});

test("without a commander every color fits", () => {
  assert.deepEqual(plan([card("Cultivate"), card("Dark Ritual")], deck("commander")).map((e) => e[1]), ["fits", "fits"]);
  // A commander left over in a deck that isn't led by one doesn't limit it.
  assert.deepEqual(plan([card("Dark Ritual")], deck("vintage", tatyova)).map((e) => e[1]), ["fits"]);
});

test("partners' colors add up", () => {
  const both = deck("commander", tatyova, card("Murderous Redcap", 1, "commander"));
  assert.deepEqual(plan([card("Dark Ritual"), card("Wrath of God")], both).map((e) => e[1]), ["fits", "off"]);
});

test("singleton decks get one copy, except cards a deck can have more of", () => {
  assert.deepEqual(plan([card("Cultivate", 4), card("Forest", 5), card("Persistent Petitioners", 20)], deck("commander", tatyova, card("Forest", 3))), [
    ["Cultivate", "fits", 1],
    ["Forest", "fits", 2],
    ["Persistent Petitioners", "fits", 20],
  ]);
});

test("other formats are topped up to the package's number", () => {
  assert.deepEqual(plan([card("Counterspell", 4)], deck("modern", card("Counterspell", 1), card("Counterspell", 1, "side"))), [["Counterspell", "fits", 2]]);
  assert.deepEqual(plan([card("Counterspell", 2)], deck(CARD_LIST, card("Counterspell", 3))), [["Counterspell", "have", 0]]);
});

test("a card being considered isn't in the deck yet, unless that's where it's going", () => {
  const d = deck("commander", tatyova, card("Cultivate", 1, "maybe"));
  assert.equal(plan([card("Cultivate")], d)[0][1], "fits");
  assert.equal(plan([card("Cultivate")], d, "maybe")[0][1], "have");
});

test("card lists take anything, banned cards included", () => {
  assert.deepEqual(plan([card("Primeval Titan"), card("Dark Ritual")], deck(CARD_LIST)).map((e) => e[1]), ["fits", "fits"]);
});

test("Conquest's hybrid cards fit either color", () => {
  const ritual = card("Dark Ritual", 1, "commander"); // stands in for a mono-black commander
  assert.equal(plan([card("Murderous Redcap")], deck("conquest", ritual))[0][1], "fits");
  assert.equal(plan([card("Murderous Redcap")], deck("commander", ritual))[0][1], "off");
});

test("a Rulebreaker's extra color follows the deck's pick, then its own cards", () => {
  const tolabow = card("Tolabow, Loch Rascal", 1, "commander");
  const pkg = [card("Dark Ritual"), card("Wrath of God")];
  assert.deepEqual(plan(pkg, { ...deck("commander", tolabow), extraColor: "W" }).map((e) => e[1]), ["off", "fits"]);
  assert.deepEqual(plan(pkg, deck("commander", tolabow, card("Dark Ritual", 1, "main"))).map((e) => e[1]), ["have", "off"]);
});

test("package colors and copies", () => {
  assert.deepEqual(packageColors([card("Cultivate"), card("Dark Ritual"), card("Wrath of God"), card("Notacard")], cardOf as never), ["W", "B", "G"]);
  assert.equal(copiesIn([{ copies: 2 }, { copies: 3 }]), 5);
});

test("validatePackage tidies names and keeps one list", () => {
  const p = validatePackage({ name: "  Ramp   staples ", note: "  ", cards: [card("Sol Ring", 1, "side")] });
  assert.deepEqual(p, { name: "Ramp staples", note: undefined, cards: [card("Sol Ring")] });
  assert.throws(() => validatePackage({ name: " ", cards: [] }), DeckError);
  assert.throws(() => validatePackage({ name: "x", cards: [card("Sol Ring", 0)] }), /Bad quantity/);
  assert.throws(() => validatePackage({ name: "x", cards: Array.from({ length: MAX_PACKAGE_CARDS + 1 }, (_, i) => card(`c${i}`)) }), /at most/);
});

test("adding a card to a package", () => {
  const cards = withCard([card("Sol Ring")], card("Cultivate", 2, "side"));
  assert.deepEqual(cards, [card("Sol Ring"), card("Cultivate", 2)]);
  assert.deepEqual(withCard(cards, card("sol ring")), [card("Sol Ring", 2), card("Cultivate", 2)]);
  assert.ok(inPackage([card("Delver of Secrets")], "Delver of Secrets // Insectile Aberration"));
});

test("card lists: their label, no commander, and any card as the cover", () => {
  assert.equal(formatLabel(CARD_LIST), "Card list");
  assert.equal(formatLabel("pauper"), "Pauper");
  assert.ok(!hasCommander(CARD_LIST));
  const cards = [{ ...card("Sol Ring"), scryfallId: "d0d33d52-3d28-4635-b985-51e126289259" }];
  assert.equal(summarize(cards).coverScryfallId, undefined);
  assert.equal(summarize(cards, true).coverScryfallId, "d0d33d52-3d28-4635-b985-51e126289259");
});
