// The deck editor's card shortcuts (src/deckShortcuts.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cardLines, deckShortcut, keyLabel } from "../src/deckShortcuts.ts";

const press = (code: string, mods: Partial<Record<"altKey" | "ctrlKey" | "metaKey" | "shiftKey", boolean>> = {}) =>
  deckShortcut({ code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });

test("Alt with a number or T, by the physical key", () => {
  assert.equal(press("Digit1", { altKey: true }), "addOne");
  assert.equal(press("Digit4", { altKey: true }), "toMaybe");
  assert.equal(press("KeyT", { altKey: true }), "tags");
  assert.equal(press("Digit1"), null);
  assert.equal(press("Digit1", { altKey: true, ctrlKey: true }), null);
  assert.equal(press("Digit9", { altKey: true }), null);
});

test("keys read as a Mac prints them", () => {
  assert.equal(keyLabel("Alt", true), "⌥");
  assert.equal(keyLabel("Ctrl", true), "⌘");
  assert.equal(keyLabel("Alt", false), "Alt");
  assert.equal(keyLabel("1", true), "1");
});

test("copied cards are one line each", () => {
  assert.equal(cardLines([{ name: "Sol Ring", quantity: 1 }, { name: "Island", quantity: 7 }]), "1 Sol Ring\n7 Island");
});
