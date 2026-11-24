import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCardNames, cardAt, CardSearch, fold, plainFits, wordDistance, type BulkCard } from "../src/cardsearch.ts";
import { fitsIdentity } from "../src/formats/conquest.ts";
import { offIdentity } from "../src/formats/rulebreakers.ts";

// Most popular first, as in card-names.json.
const NAMES = [
  "Sol Ring", "Swords to Plowshares", "Path to Exile", "Solemn Simulacrum", "Rhystic Study", "Cyclonic Rift",
  "Lightning Bolt", "Atraxa, Praetors' Voice", "Yuriko, the Tiger's Shadow", "Bolt Bend", "Sensei's Divining Top",
  "Esper Sentinel", "Lim-Dûl's Vault", "Jötun Grunt", "Fire // Ice", "Delver of Secrets // Insectile Aberration",
  "Lightning Blow", "Radiant Solar", "Sigiled Sentinel", "Gilded Sentinel", "Aether Vial",
];
const cards = new CardSearch(NAMES);
const first = (q: string) => cards.search(q).names[0];

test("typing part of a name matches as you go, most popular first", () => {
  assert.deepEqual(cards.search("so").names.slice(0, 2), ["Sol Ring", "Solemn Simulacrum"]);
  assert.equal(cards.search("sol r").kind, "match");
  assert.equal(first("sol r"), "Sol Ring");
  assert.equal(first("ring"), "Sol Ring");
});

test("a whole word counts as much as the start of the name", () => {
  assert.deepEqual(cards.search("bolt").names, ["Lightning Bolt", "Bolt Bend"]);
});

test("either face of a card, and words in any order", () => {
  assert.equal(first("ice"), "Fire // Ice");
  assert.equal(first("fire // ice"), "Fire // Ice");
  assert.equal(first("insectile"), "Delver of Secrets // Insectile Aberration");
  assert.equal(first("path exile"), "Path to Exile");
});

test("accents, punctuation and case don't matter", () => {
  assert.equal(fold("Lim-Dûl's Vault"), "lim duls vault");
  for (const [q, name] of [["lim duls vault", "Lim-Dûl's Vault"], ["JOTUN", "Jötun Grunt"], ["senseis", "Sensei's Divining Top"], ["sensei’s", "Sensei's Divining Top"], ["æther vial", "Aether Vial"]]) {
    assert.equal(first(q), name, q);
    assert.equal(cards.search(q).kind, "match", q);
  }
});

test("misspelled names are guessed", () => {
  for (const [q, name] of [
    ["swrods to plowshares", "Swords to Plowshares"],
    ["sol rign", "Sol Ring"],
    ["rhystic stdy", "Rhystic Study"],
    ["cyclnic", "Cyclonic Rift"],
    ["atraxa pretors", "Atraxa, Praetors' Voice"],
    ["yurko", "Yuriko, the Tiger's Shadow"],
    ["sensais divning top", "Sensei's Divining Top"],
    ["lighning blot", "Lightning Bolt"],
  ]) {
    const r = cards.search(q);
    assert.equal(r.names[0], name, q);
    assert.equal(r.kind, "guess", q);
    assert.equal(r.known, false, q);
  }
});

test("missing and extra spaces", () => {
  assert.equal(first("swordstoplow"), "Swords to Plowshares");
  assert.equal(first("light ning bolt"), "Lightning Bolt");
});

test("a typo that happens to be inside another word still gets guesses", () => {
  assert.ok(cards.search("giled sentinel").names.includes("Gilded Sentinel"));
});

test("text like no name finds nothing", () => {
  assert.deepEqual(cards.search("qqqxxx"), { names: [], kind: "none", known: false });
  assert.deepEqual(cards.search("  ,. ").names, []);
  assert.equal(cards.search("x".repeat(5000)).kind, "none");
});

test("cards the deck can't play are left out, and known about", () => {
  const allowed = Uint8Array.from(NAMES, (n) => (n === "Lightning Bolt" ? 0 : 1));
  assert.deepEqual(cards.search("bolt", 8, allowed).names, ["Bolt Bend"]);
  const gone = cards.search("lightning bolt", 8, allowed);
  assert.equal(gone.known, true);
  assert.ok(!gone.names.includes("Lightning Bolt"));
  assert.ok(!cards.search("lightnig bolt", 8, allowed).names.includes("Lightning Bolt"));
});

test("word distance: a swap is one edit, and the start of a word costs a little", () => {
  assert.equal(wordDistance("tihte", "tithe", 2), 1);
  assert.equal(wordDistance("bolt", "bolt", 1), 0);
  assert.equal(wordDistance("light", "lightning", 1), 0.25);
  assert.equal(wordDistance("abcdef", "zzzzzz", 2), 99);
});

const bulk = (c: Partial<BulkCard> & { name: string }): BulkCard => ({ layout: "normal", color_identity: [], type_line: "Artifact", ...c });
const data = buildCardNames([
  bulk({ name: "Boros Reckoner", color_identity: ["W", "R"], mana_cost: "{R/W}{R/W}{R/W}", oracle_text: "{R/W}: First strike.", type_line: "Creature — Minotaur Wizard", power: "3", cmc: 3, edhrec_rank: 50 }),
  bulk({ name: "Sol Ring", edhrec_rank: 1 }),
  bulk({ name: "Lightning Helix", color_identity: ["W", "R"], mana_cost: "{R}{W}", type_line: "Instant", edhrec_rank: 20 }),
  bulk({ name: "Emrakul", type_line: "Legendary Creature — Eldrazi", power: "15", cmc: 15, edhrec_rank: 30 }),
  bulk({ name: "Delver of Secrets // Insectile Aberration", layout: "transform", color_identity: ["U"], type_line: "Creature — Human Wizard // Creature — Human Insect", card_faces: [{ type_line: "Creature — Human Wizard", mana_cost: "{U}", power: "1" }, { type_line: "Creature — Human Insect", power: "3", color_indicator: ["U"] }] }),
  bulk({ name: "Goblin", layout: "token" }),
  bulk({ name: "Sol Ring // Sol Ring", layout: "art_series" }),
  bulk({ name: "A-Luminarch Aspirant", color_identity: ["W"] }),
]);
const at = (name: string) => cardAt(data, data.names.indexOf(name));

test("the name list: real cards only, most popular first", () => {
  assert.deepEqual(data.names, ["Sol Ring", "Lightning Helix", "Emrakul", "Boros Reckoner", "Delver of Secrets // Insectile Aberration"]);
  assert.deepEqual(at("Lightning Helix").color_identity, ["W", "R"]);
  assert.equal(at("Delver of Secrets // Insectile Aberration").type_line, "Creature — Human Wizard");
});

test("the name list keeps enough for the color identity rules", () => {
  const red = new Set(["R"]);
  assert.equal(plainFits(at("Boros Reckoner"), red), false);
  assert.equal(fitsIdentity(at("Boros Reckoner"), red), true); // Conquest: a hybrid symbol is either half
  assert.equal(fitsIdentity(at("Lightning Helix"), red), false);
  const off = (name: string, commander: string) =>
    offIdentity([{ name, card: at(name) }], [{ ...at("Sol Ring"), name: commander }], plainFits).length;
  assert.equal(off("Lightning Helix", "Daxiver, Izzet Electromancer"), 0); // any instant
  assert.equal(off("Boros Reckoner", "Hadran, Naya Sunseeder"), 1); // power 3
});
