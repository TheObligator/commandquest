// Second commanders (src/formats/partners.ts), on Scryfall-shaped cards with their real oracle text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canPair, pairings, partnerQuery, partnerSlotLabel, type PairCard } from "../src/formats/partners.ts";

const card = (name: string, type_line: string, oracle_text = ""): PairCard => ({ name, type_line, oracle_text });

const akiri = card("Akiri, Line-Slinger", "Legendary Creature — Kor Soldier Ally", "First strike, vigilance\nAkiri gets +1/+0 for each artifact you control.\nPartner (You can have two commanders if both have partner.)");
const thrasios = card("Thrasios, Triton Hero", "Legendary Creature — Merfolk Wizard", "{4}: Scry 1, then reveal the top card of your library.\nPartner (You can have two commanders if both have partner.)");
const pir = card("Pir, Imaginative Rascal", "Legendary Creature — Human", "Partner with Toothy, Imaginary Friend (When this creature enters, target player may put Toothy into their hand from their library, then shuffle.)\nIf one or more counters would be put on a permanent your team controls, that many plus one of each of those kinds of counters are put on that permanent instead.");
const toothy = card("Toothy, Imaginary Friend", "Legendary Creature — Illusion", "Partner with Pir, Imaginative Rascal (When this creature enters, target player may put Pir into their hand from their library, then shuffle.)\nWhenever you draw a card, put a +1/+1 counter on Toothy.");
const abby = card("Abby, Merciless Soldier", "Legendary Creature — Human Soldier", "Partner—Survivors (You can have two commanders if both have this ability.)");
const ellie = card("Ellie, Vengeful Hunter", "Legendary Creature — Human Survivor", "Partner—Survivors (You can have two commanders if both have this ability.)");
const cecily = card("Cecily, Haunted Mage", "Legendary Creature — Human Wizard", "Partner—Friends forever (You can have two commanders if both have this ability.)");
const oldFriends = card("Old Friend", "Legendary Creature — Human", "Friends forever (You can have two commanders if both have friends forever.)");
const abdel = card("Abdel Adrian, Gorion's Ward", "Legendary Creature — Human Warrior", "When Abdel Adrian enters, exile any number of other nonland permanents you control until Abdel Adrian leaves the battlefield.\nChoose a Background (You can have a Background as a second commander.)");
const acolyte = card("Acolyte of Bahamut", "Legendary Enchantment — Background", "Commander creatures you own have \"The first Dragon spell you cast each turn costs {2} less to cast.\"");
const amy = card("Amy Pond", "Legendary Creature — Human", "Partner with Rory Williams (When this creature enters, target player may put Rory into their hand from their library, then shuffle.)\nWhenever Amy Pond deals combat damage to a player, choose a suspended card you own.\nDoctor's companion (You can have two commanders if the other is the Doctor.)");
const rory = card("Rory Williams", "Legendary Creature — Human Soldier", "Partner with Amy Pond (When this creature enters, target player may put Amy into their hand from their library, then shuffle.)\nFirst strike, lifelink\nDoctor's companion (You can have two commanders if the other is the Doctor.)");
const tenth = card("The Tenth Doctor", "Legendary Creature — Time Lord Doctor", "Allons-y! — Whenever you attack, exile cards from the top of your library until you exile a nonland card.");
const atraxa = card("Atraxa, Praetors' Voice", "Legendary Creature — Phyrexian Angel Horror", "Flying, vigilance, deathtouch, lifelink\nAt the beginning of your end step, proliferate.");

test("plain partners pair with each other, not with partner-with or group partners", () => {
  assert.deepEqual(pairings(akiri), [{ kind: "partner" }]);
  assert.equal(canPair(akiri, thrasios), true);
  assert.equal(canPair(akiri, pir), false);
  assert.equal(canPair(akiri, abby), false);
  assert.equal(canPair(akiri, atraxa), false);
  assert.equal(canPair(akiri, akiri), false);
});

test("partner with names exactly one card", () => {
  assert.deepEqual(pairings(pir), [{ kind: "partnerWith", name: "Toothy, Imaginary Friend" }]);
  assert.equal(canPair(pir, toothy), true);
  assert.equal(canPair(toothy, pir), true);
  assert.equal(canPair(pir, thrasios), false);
  assert.equal(partnerSlotLabel(pir), "Toothy, Imaginary Friend");
  assert.match(partnerQuery(pir)!, /!"Toothy, Imaginary Friend"/);
});

test("Partner—group only pairs within its group; old Friends forever text counts", () => {
  assert.equal(canPair(abby, ellie), true);
  assert.equal(canPair(abby, cecily), false);
  assert.equal(canPair(cecily, oldFriends), true);
  assert.equal(partnerSlotLabel(abby), "Partner—Survivors");
  assert.match(partnerQuery(abby)!, /o:"Partner—Survivors"/);
});

test("Choose a Background pairs with Backgrounds, both ways", () => {
  assert.equal(canPair(abdel, acolyte), true);
  assert.equal(canPair(acolyte, abdel), true);
  assert.equal(canPair(abdel, akiri), false);
  assert.equal(partnerSlotLabel(abdel), "Background");
  assert.equal(partnerSlotLabel(acolyte), "Commander");
});

test("Doctor's companion pairs with a Time Lord Doctor; Amy also partners with Rory", () => {
  assert.equal(canPair(amy, tenth), true);
  assert.equal(canPair(tenth, amy), true);
  assert.equal(canPair(amy, rory), true);
  assert.equal(canPair(tenth, rory), true);
  assert.equal(canPair(tenth, card("The Doctor's Childhood Barn", "Legendary Land"), ), false);
  assert.equal(canPair(amy, card("Time Lord Pretender", "Legendary Creature — Time Lord Doctor Human")), false);
  assert.equal(partnerSlotLabel(amy), "Rory Williams or Doctor");
  assert.equal(partnerSlotLabel(tenth), "Doctor's companion");
  assert.match(partnerQuery(amy)!, /^\(!"Rory Williams" or \(t:legendary t:creature t:time t:lord t:doctor\)\) -!"Amy Pond" legal:commander$/);
});

test("a commander without a pairing ability gets no second slot", () => {
  assert.equal(partnerSlotLabel(atraxa), undefined);
  assert.equal(partnerQuery(atraxa), undefined);
});
