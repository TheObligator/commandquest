// Rulebreaker commanders' deck rules (src/formats/rulebreakers.ts), on hand-made Scryfall-shaped cards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitsIdentity, validateConquest, type RulesCard } from "../src/formats/conquest.ts";
import { bestExtraColor, extraColorChoice, identityQuery, mentionsIdentity, noMaxDeckSize, offIdentity, rulebreaker } from "../src/formats/rulebreakers.ts";

const card = (name: string, type_line: string, color_identity: string[], extra: Partial<RulesCard & { power: string; cmc: number }> = {}) =>
  ({ name, type_line, color_identity, layout: "normal", mana_cost: "", oracle_text: "", legalities: {}, keywords: [], ...extra }) as RulesCard;
const subset = (c: RulesCard, id: Set<string>) => c.color_identity.every((x) => id.has(x));
const off = (main: RulesCard[], cmdrs: RulesCard[], extra?: string) =>
  offIdentity(main.map((c) => ({ name: c.name, card: c })), cmdrs, subset, extra).map((e) => e.name);

const whtz = card("Whtz, the Bibliophile", "Legendary Creature — Homunculus", ["W", "U"]);
const tolabow = card("Tolabow, Loch Rascal", "Legendary Creature — Otter Wizard", ["U", "R"]);
const everforger = card("The Everforger", "Legendary Creature — Dwarf Artificer", ["R"]);
const hadran = card("Hadran, Naya Sunseeder", "Legendary Creature — Human Druid", ["R", "G", "W"]);
const atraxa = card("Atraxa, Praetors' Voice", "Legendary Creature — Phyrexian Angel Horror", ["W", "U", "B", "G"]);

test("Whtz and The Covert Blue Mage lift the maximum deck size; others don't", () => {
  assert.equal(noMaxDeckSize([whtz]), true);
  assert.equal(noMaxDeckSize([card("The Covert Blue Mage", "Legendary Creature", ["W", "U"])]), true);
  assert.equal(noMaxDeckSize([tolabow, atraxa]), false);
  assert.ok(rulebreaker({ name: "whtz, the bibliophile" }), "matches regardless of case");
});

test("any-identity rules let their cards in and nothing else", () => {
  const golem = card("Myr Battlesphere", "Artifact Creature — Myr Construct", []);
  const blueArtifactCreature = card("Phyrexian Metamorph", "Artifact Creature — Phyrexian Shapeshifter", ["U"]);
  const greenEquipment = card("Bonesplitter-ish", "Artifact — Equipment", ["G"]);
  const forest = card("Forest", "Basic Land — Forest", ["G"]);
  const llanowar = card("Llanowar Elves", "Creature — Elf Druid", ["G"]);
  assert.deepEqual(off([golem, blueArtifactCreature, greenEquipment, forest, llanowar], [everforger]), ["Llanowar Elves"]);
  // Without the Rulebreaker, all the colored ones are out.
  assert.deepEqual(off([blueArtifactCreature, forest], [card("Krenko", "Legendary Creature", ["R"])]), ["Phyrexian Metamorph", "Forest"]);
});

test("Hadran: creatures with power 4 or more; '*' counts as 0", () => {
  const big = card("Big Blue", "Creature — Leviathan", ["U"], { power: "6" });
  const small = card("Small Blue", "Creature — Merfolk", ["U"], { power: "2" });
  const star = card("Star Blue", "Creature — Shapeshifter", ["U"], { power: "*" });
  assert.deepEqual(off([big, small, star], [hadran]), ["Small Blue", "Star Blue"]);
});

test("Tolabow: one extra color for instants and sorceries, the deck's pick or else the best one", () => {
  const green1 = card("Green Sorcery", "Sorcery", ["G"]);
  const green2 = card("Green Instant", "Instant", ["U", "G"]);
  const black = card("Black Instant", "Instant", ["B"]);
  const greenCreature = card("Green Creature", "Creature — Elf", ["G"]);
  const main = [green1, green2, black, greenCreature];
  assert.equal(extraColorChoice([tolabow]), "instants and sorceries");
  assert.equal(extraColorChoice([whtz]), undefined);
  assert.deepEqual(off(main, [tolabow]), ["Black Instant", "Green Creature"]); // green fixes the most
  assert.deepEqual(off(main, [tolabow], "B"), ["Green Sorcery", "Green Instant", "Green Creature"]);
  assert.deepEqual(off(main, [tolabow], "U"), ["Black Instant", "Green Creature"]); // already in identity: ignored
});

test("bestExtraColor picks the color most of the deck's spells need, by copies", () => {
  const entries = (cs: [RulesCard, number][]) => cs.map(([c, quantity]) => ({ card: c, quantity }));
  const g = card("G Sorcery", "Sorcery", ["G"]);
  const b1 = card("B Instant", "Instant", ["B"]);
  const b2 = card("B Sorcery", "Sorcery", ["B"]);
  const gCreature = card("G Creature", "Creature", ["G"]);
  assert.equal(bestExtraColor(entries([[g, 1], [b1, 1], [b2, 1], [gCreature, 5]]), [tolabow], subset), "B"); // creatures don't count
  assert.equal(bestExtraColor(entries([[g, 3], [b1, 1]]), [tolabow], subset), "G");
  assert.equal(bestExtraColor(entries([[card("Opt", "Instant", ["U"]), 1]]), [tolabow], subset), undefined);
  assert.equal(bestExtraColor(entries([[g, 1]]), [whtz], subset), undefined);
});

test("Conquest uses the same rules on top of its hybrid relaxation", () => {
  const aura = card("Green Aura", "Enchantment — Aura", ["G"], { mana_cost: "{G}" });
  const planeswalker = card("The Unluckiest Planeswalker", "Legendary Planeswalker", ["R"]);
  const entries = [
    { name: planeswalker.name, quantity: 1, board: "commander" as const, card: planeswalker },
    { name: aura.name, quantity: 1, board: "main" as const, card: aura },
  ];
  assert.ok(validateConquest(entries).some((p) => /Outside your commander's colors/.test(p)));
  const withRules = validateConquest(entries, (main, cmdrs) => offIdentity(main, cmdrs, fitsIdentity));
  assert.ok(!withRules.some((p) => /Outside your commander's colors/.test(p)));
});

test("search clause: identity plus what the Rulebreaker allows", () => {
  assert.equal(identityQuery([atraxa]), "id<=wubg");
  assert.equal(identityQuery([card("Kozilek", "Legendary Creature", [])]), "id:c");
  assert.equal(identityQuery([hadran]), "(id<=wrg or ((t:creature pow>=4)))");
  assert.equal(identityQuery([tolabow]), "(id<=ur or ((t:basic t:land)))");
  assert.equal(identityQuery([tolabow], "G"), "(id<=ur or ((t:basic t:land)) or ((t:instant or t:sorcery) id<=urg))");
  assert.equal(identityQuery([atraxa], undefined, true), "(id<=wubg or is:hybrid)");
});

test("a query that already filters by identity is left alone", () => {
  assert.equal(mentionsIdentity("t:dragon id:r"), true);
  assert.equal(mentionsIdentity("ci<=wu removal"), true);
  assert.equal(mentionsIdentity("-identity:g"), true);
  assert.equal(mentionsIdentity("t:dragon c:r"), false);
  assert.equal(mentionsIdentity("Idyllic Tutor"), false);
});
