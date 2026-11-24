import { test } from "node:test";
import assert from "node:assert/strict";
import { abilityName, abilityText, isEveryCopy, settingFor, withSaved, type SavedAbility } from "../src/game/abilities.ts";

const KICK = "Chun-Li, Countless Kicks (12): Lightning Kick — Whenever Chun-Li attacks, copy each exiled card (with a kick counter): cast them.";

test("abilityText: the key without its card, also when the text has its own parentheses", () => {
  assert.equal(abilityText(KICK), "Lightning Kick — Whenever Chun-Li attacks, copy each exiled card (with a kick counter): cast them.");
  assert.equal(abilityText("no card"), "no card");
});

test("settingFor: every copy by the ability's text, one card by its key", () => {
  const text = abilityText(KICK);
  const other = KICK.replace("(12)", "(40)");
  const s = { set: { [text]: { autoYield: false, decision: "ACCEPT" as const }, [KICK]: { autoYield: true, decision: "ASK" as const } }, cardOnly: [KICK] };
  assert.deepEqual(settingFor(s, other), { autoYield: false, decision: "ACCEPT" });
  assert.deepEqual(settingFor(s, KICK), { autoYield: true, decision: "ASK" });
  assert.equal(isEveryCopy(s, KICK), false);
  assert.deepEqual(settingFor(undefined, KICK), { autoYield: false, decision: "ASK" });
});

test("abilityName: ability word, keyword, or how it starts", () => {
  assert.equal(abilityName(abilityText(KICK)), "Lightning Kick");
  assert.equal(abilityName("Prowess (Whenever you cast a noncreature spell, this gets +1/+1.)"), "Prowess");
  assert.equal(abilityName("When Chun-Li enters, exile up to X target instant cards from your graveyard."), "When Chun-Li enters");
  assert.ok(abilityName("Whenever one or more creatures you control with flying deal combat damage to a player draw a card.").endsWith("…"));
});

test("withSaved: adds, replaces in place, and takes out what's cleared", () => {
  let list: SavedAbility[] = withSaved([], "A", "one", { autoYield: true, decision: "ASK" });
  list = withSaved(list, "B", "two", { autoYield: false, decision: "DECLINE" });
  assert.deepEqual(list, [{ card: "A", text: "one", autoYield: true }, { card: "B", text: "two", decision: "DECLINE" }]);
  list = withSaved(list, "A", "one", { autoYield: false, decision: "ACCEPT" });
  assert.deepEqual(list.map((a) => [a.text, a.autoYield, a.decision]), [["one", undefined, "ACCEPT"], ["two", undefined, "DECLINE"]]);
  assert.deepEqual(withSaved(list, "A", "one", { autoYield: false, decision: "ASK" }).map((a) => a.text), ["two"]);
});
