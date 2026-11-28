import { test } from "node:test";
import assert from "node:assert/strict";
import { keywordIcon, withoutGained } from "../src/game/gained.ts";
import { manaSymbolClass } from "../src/manaSymbols.ts";

test("keyword icons: plain, colored protection and landwalk; none for keywords the font lacks", () => {
  assert.equal(keywordIcon("Flying", "Flying"), "ms ms-ability-flying");
  assert.equal(keywordIcon("First Strike", "First Strike"), "ms ms-ability-first-strike");
  assert.equal(keywordIcon("Protection", "Protection from red"), "ms ms-ability-protection-red");
  assert.equal(keywordIcon("Protection", "Protection from creatures"), "ms ms-ability-protection");
  assert.equal(keywordIcon("Hexproof", "Hexproof from black"), "ms ms-ability-hexproof-black");
  assert.equal(keywordIcon("Landwalk", "Islandwalk"), "ms ms-ability-islandwalk");
  assert.equal(keywordIcon("Landwalk", "Legendary landwalk"), undefined);
  assert.equal(keywordIcon("Myriad", "Myriad"), undefined);
  assert.equal(keywordIcon(undefined, "{T}: Add {G}."), undefined);
});

test("Forge's text without what was gained", () => {
  const text = "Flying, Haste\r\nVigilance\r\n\r\nWhen this enters, draw a card.\r\n{T}: Add one mana of any color.";
  const gained = [
    { text: "Haste", keyword: "Haste" },
    { text: "Vigilance", keyword: "Vigilance" },
    { text: "{T}: Add one mana of any color." },
  ];
  assert.equal(withoutGained(text, gained), "Flying\n\nWhen this enters, draw a card.");
  assert.equal(withoutGained(text, undefined), text);
});

test("mana symbols in the Mana font", () => {
  assert.equal(manaSymbolClass("G"), "ms ms-g ms-cost");
  assert.equal(manaSymbolClass("W/U"), "ms ms-wu ms-cost");
  assert.equal(manaSymbolClass("2/W"), "ms ms-2w ms-cost");
  assert.equal(manaSymbolClass("G/P"), "ms ms-gp ms-cost");
  assert.equal(manaSymbolClass("12"), "ms ms-12 ms-cost");
  assert.equal(manaSymbolClass("T"), "ms ms-tap ms-cost");
  assert.equal(manaSymbolClass("H"), undefined);
});
