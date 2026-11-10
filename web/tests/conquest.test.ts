// Conquest deck-construction rules, checked against real Scryfall card data
// (tests/fixtures/conquest-cards.json: rules text and legality only, fetched 2026-11-08).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cardLegality, commanderProblems, fitsIdentity, isCommanderEligible, maxCopies, validateConquest,
  type DeckEntry, type RulesCard,
} from "../src/formats/conquest.ts";

const cards: Record<string, RulesCard> = JSON.parse(readFileSync(new URL("./fixtures/conquest-cards.json", import.meta.url), "utf8"));
const c = (name: string) => {
  const card = cards[name];
  assert.ok(card, `fixture missing: ${name}`);
  return card;
};
const ids = (s: string) => new Set(s.split(""));

test("card pool: Reserved List, ban list, Conspiracies and removed cards are out; restricted is fine", () => {
  assert.deepEqual(cardLegality(c("Badlands")), { ok: false, reason: "on the Reserved List" });
  assert.equal(cardLegality(c("Sol Ring")).reason, "banned in Conquest"); // restricted in Vintage, banned here
  assert.equal(cardLegality(c("Invoke Prejudice")).ok, false); // removed by Wizards (and reserved)
  assert.match(cardLegality(c("Brago's Favor")).reason!, /Conspiracy/);
  assert.equal(cardLegality(c("Sensei's Divining Top")).ok, true);
  assert.equal(cardLegality(c("Space Beleren")).ok, true); // black-bordered Unfinity card
  assert.match(cardLegality({ ...c("Space Beleren"), legalities: { vintage: "not_legal" } }).reason!, /silver border, acorn/);
});

test("ban list matches with curly apostrophes and on the front face name", () => {
  assert.equal(cardLegality({ ...c("Sensei's Divining Top"), name: "Mystical Tutor" }).ok, false);
  assert.equal(commanderProblems([{ ...c("Tymna the Weaver"), name: "Yuriko, the Tiger’s Shadow" }]).length, 1);
});

test("commander eligibility (rule 1)", () => {
  assert.equal(isCommanderEligible(c("Wyleth, Soul of Steel")), true);
  assert.equal(isCommanderEligible(c("Space Beleren")), true); // legendary planeswalker
  assert.equal(isCommanderEligible(c("Shorikai, Genesis Engine")), true); // legendary vehicle
  assert.equal(isCommanderEligible(c("Smuggler's Copter")), false); // vehicle, not legendary
  assert.equal(isCommanderEligible(c("Westvale Abbey")), true); // back face is a legendary creature
  assert.equal(isCommanderEligible(c("Kytheon, Hero of Akros")), true);
  assert.equal(isCommanderEligible(c("Delver of Secrets")), false);
  assert.equal(isCommanderEligible(c("Raised by Giants")), false); // Background alone
});

test("commander pairs and per-commander bans", () => {
  assert.deepEqual(commanderProblems([c("Wyleth, Soul of Steel")]), []);
  assert.match(commanderProblems([c("Tymna the Weaver"), c("Kraum, Ludevic's Opus")])[0], /Tymna the Weaver is banned as a commander/);
  assert.match(commanderProblems([c("Wyleth, Soul of Steel"), c("Atraxa, Praetors' Voice")])[0], /only allowed if both have partner/);
  assert.match(commanderProblems([])[0], /No commander/);
});

test("hybrid color identity (rule 6)", () => {
  // Kitchen Finks {1}{G/W}{G/W}: fits a mono-green or mono-white commander.
  assert.equal(fitsIdentity(c("Kitchen Finks"), ids("G")), true);
  assert.equal(fitsIdentity(c("Kitchen Finks"), ids("W")), true);
  assert.equal(fitsIdentity(c("Kitchen Finks"), ids("U")), false);
  // Spectral Procession {2/W}{2/W}{2/W}: payable with generic mana, so it fits any deck.
  assert.equal(fitsIdentity(c("Spectral Procession"), ids("B")), true);
  // Boros Reckoner: {R/W} in both cost and rules text, so mono-white is fine…
  assert.equal(fitsIdentity(c("Boros Reckoner"), ids("W")), true);
  // …but a plain {R} anywhere in the rules text would require red.
  const variant = { ...c("Boros Reckoner"), oracle_text: "{R}: This creature gains first strike until end of turn." };
  assert.equal(fitsIdentity(variant, ids("W")), false);
  assert.equal(fitsIdentity(variant, ids("R")), true);
  // Extort's reminder text {W/B} doesn't count.
  assert.equal(fitsIdentity(c("Syndicate Enforcer"), ids("B")), true);
  // Color indicator on a back face still counts; "is all colors" (a CDA) still counts.
  assert.equal(fitsIdentity(c("Delver of Secrets"), ids("W")), false);
  assert.equal(fitsIdentity(c("Transguild Courier"), ids("WUBR")), false);
  assert.equal(fitsIdentity(c("Transguild Courier"), ids("WUBRG")), true);
});

test("singleton, with card text overrides", () => {
  assert.equal(maxCopies(c("Plains")), Infinity);
  assert.equal(maxCopies(c("Faceless Haven")), 1); // snow land, not basic
  assert.equal(maxCopies(c("Relentless Rats")), Infinity);
  assert.equal(maxCopies(c("Seven Dwarves")), 7);
  assert.equal(maxCopies(c("Sensei's Divining Top")), 1);
});

test("whole-deck validation", () => {
  const entry = (name: string, quantity: number, board: DeckEntry["board"] = "main"): DeckEntry => ({ name, quantity, board, card: c(name) });
  const legal = [
    entry("Wyleth, Soul of Steel", 1, "commander"),
    entry("Kitchen Finks", 1),
    entry("Spectral Procession", 1),
    entry("Relentless Rats", 3), // red-white deck: off-color, see below
    entry("Plains", 74),
  ];
  const problems = validateConquest(legal);
  assert.deepEqual(problems, ["Outside your commander's colors: Relentless Rats."]);

  const bad = validateConquest([
    entry("Wyleth, Soul of Steel", 1, "commander"),
    entry("Sol Ring", 1),
    entry("Badlands", 1),
    entry("Sensei's Divining Top", 2),
    entry("Plains", 10),
    { name: "Lutri, the Spellchaser", quantity: 1, board: "side" },
    entry("Brago's Favor", 1, "maybe"), // maybeboard isn't checked
  ]);
  assert.ok(bad.some((p) => /at least 80 cards/.test(p) && /you have 15/.test(p)), bad.join("\n"));
  assert.ok(bad.some((p) => /singleton.*Sensei's Divining Top/.test(p)));
  assert.ok(bad.some((p) => /banned in Conquest: Sol Ring/.test(p)));
  assert.ok(bad.some((p) => /Reserved List: Badlands/.test(p)));
  assert.ok(bad.some((p) => /Banned as a companion.*Lutri/.test(p)));
  assert.ok(!bad.some((p) => /Brago/.test(p)));
});
