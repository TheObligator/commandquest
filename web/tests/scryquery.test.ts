import { test } from "node:test";
import assert from "node:assert/strict";
import { compileQuery, type QueryCard } from "../src/game/scryquery.ts";

const CARDS: QueryCard[] = [
  { name: "Llanowar Elves", type_line: "Creature — Elf Druid", oracle_text: "{T}: Add {G}.", mana_cost: "{G}", cmc: 1, power: "1", toughness: "1", colors: ["G"], color_identity: ["G"], rarity: "common" },
  { name: "Counterspell", type_line: "Instant", oracle_text: "Counter target spell.", mana_cost: "{U}{U}", cmc: 2, colors: ["U"], color_identity: ["U"], rarity: "uncommon" },
  { name: "Sol Ring", type_line: "Artifact", oracle_text: "{T}: Add {C}{C}.", mana_cost: "{1}", cmc: 1, colors: [], color_identity: [], rarity: "uncommon" },
  { name: "Forest", type_line: "Basic Land — Forest", oracle_text: "({T}: Add {G}.)", cmc: 0, colors: [], color_identity: ["G"], rarity: "common" },
  { name: "Kenrith, the Returned King", type_line: "Legendary Creature — Human Noble", oracle_text: "{4}{W}: Target player gains 5 life.\nKenrith can't be blocked by walls.", mana_cost: "{4}{W}", cmc: 5, power: "5", toughness: "5", colors: ["W"], color_identity: ["W", "U", "B", "R", "G"], rarity: "mythic", keywords: ["Trample"] },
  { name: "Fire // Ice", type_line: "Instant // Instant", cmc: 4, colors: ["R", "U"], color_identity: ["R", "U"], rarity: "uncommon", card_faces: [
    { name: "Fire", type_line: "Instant", oracle_text: "Fire deals 2 damage divided as you choose.", mana_cost: "{1}{R}" },
    { name: "Ice", type_line: "Instant", oracle_text: "Tap target permanent.\nDraw a card.", mana_cost: "{1}{U}" },
  ] },
];

const names = (q: string) => {
  const f = compileQuery(q);
  if (typeof f !== "function") throw new Error(f.error);
  return CARDS.filter(f).map((c) => c.name);
};

test("plain words match the name, in any order", () => {
  assert.deepEqual(names("elves"), ["Llanowar Elves"]);
  assert.deepEqual(names("king kenrith"), ["Kenrith, the Returned King"]);
  assert.deepEqual(names("ice"), ["Fire // Ice"]);
  assert.deepEqual(names('!"sol ring"'), ["Sol Ring"]);
  assert.equal(names("").length, CARDS.length);
});

test("types, text and keywords", () => {
  assert.deepEqual(names("t:creature"), ["Llanowar Elves", "Kenrith, the Returned King"]);
  assert.deepEqual(names("t:legendary t:creature"), ["Kenrith, the Returned King"]);
  assert.deepEqual(names('o:"draw a card"'), ["Fire // Ice"]);
  assert.deepEqual(names('o:"~ can\'t be blocked"'), ["Kenrith, the Returned King"]);
  assert.deepEqual(names("kw:trample"), ["Kenrith, the Returned King"]);
});

test("colours: c: is at least, id: is within", () => {
  assert.deepEqual(names("c:g"), ["Llanowar Elves"]);
  assert.deepEqual(names("c:c"), ["Sol Ring", "Forest"]);
  assert.deepEqual(names("c:m"), ["Fire // Ice"]);
  assert.deepEqual(names("c:izzet"), ["Fire // Ice"]);
  assert.deepEqual(names("id:g"), ["Llanowar Elves", "Sol Ring", "Forest"]);
  assert.deepEqual(names("id=wubrg"), ["Kenrith, the Returned King"]);
});

test("numbers: mana value, power, toughness", () => {
  assert.deepEqual(names("mv<=1 -t:land"), ["Llanowar Elves", "Sol Ring"]);
  assert.deepEqual(names("cmc>=5"), ["Kenrith, the Returned King"]);
  assert.deepEqual(names("pow>=5"), ["Kenrith, the Returned King"]);
  assert.deepEqual(names("pow=tou t:elf"), ["Llanowar Elves"]);
  assert.deepEqual(names("m:uu"), ["Counterspell"]);
  assert.deepEqual(names("m:{R}"), ["Fire // Ice"]);
});

test("or, negation, parentheses, is:", () => {
  assert.deepEqual(names("t:instant or t:artifact"), ["Counterspell", "Sol Ring", "Fire // Ice"]);
  assert.deepEqual(names("(t:instant or t:artifact) -c:u"), ["Sol Ring"]);
  assert.deepEqual(names("is:permanent -t:land"), ["Llanowar Elves", "Sol Ring", "Kenrith, the Returned King"]);
  assert.deepEqual(names("not:permanent"), ["Counterspell", "Fire // Ice"]);
  assert.deepEqual(names("r>=rare"), ["Kenrith, the Returned King"]);
});

test("a query it can't read says why", () => {
  for (const q of ["(t:elf", "t:elf)", "zz:3", 'o:"open', "c:purple"]) {
    const f = compileQuery(q);
    assert.equal(typeof f, "object", q);
  }
});
