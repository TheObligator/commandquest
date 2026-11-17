import { test } from "node:test";
import assert from "node:assert/strict";
import { stackText } from "../src/game/stackText.ts";

test("stackText: drops the bracket that only names the item's own card", () => {
  const raw = "When Temple of Enlightenment enters, scry 1. [Zone Changer: Temple of Enlightenment (831)]";
  assert.deepEqual(stackText(raw, "Temple of Enlightenment"), { text: "When Temple of Enlightenment enters, scry 1.", info: [] });
});

test("stackText: keeps other cards, without their ids, and copes with commas in names", () => {
  const raw = "Whenever another creature enters, gain 1 life. [Zone Changer: Kenrith, the Returned King (12), Attacker: Llanowar Elves (40)]";
  assert.deepEqual(stackText(raw, "Soul Warden"), {
    text: "Whenever another creature enters, gain 1 life.",
    info: ["Zone Changer: Kenrith, the Returned King", "Attacker: Llanowar Elves"],
  });
});

test("stackText: text without a bracket is unchanged", () => {
  assert.deepEqual(stackText("Draw a card.", "Opt"), { text: "Draw a card.", info: [] });
});
