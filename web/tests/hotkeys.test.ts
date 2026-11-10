import { test } from "node:test";
import assert from "node:assert/strict";
import { bind, changedKeys, DEFAULT_HOTKEYS, keyName, validKey, withDefaults } from "../src/game/hotkeys.ts";

test("default hotkeys use no function keys and no key twice", () => {
  const keys = Object.values(DEFAULT_HOTKEYS);
  assert.ok(keys.every((k) => !/^F\d+$/.test(k)));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(DEFAULT_HOTKEYS.holdPriority, "Shift");
});

test("key names: letters upper-case, space named, reserved keys refused", () => {
  assert.equal(keyName("e"), "E");
  assert.equal(keyName(" "), "Space");
  assert.equal(keyName("Shift"), "Shift");
  assert.ok(validKey("Space") && validKey("1") && validKey("") && validKey("ArrowUp"));
  assert.ok(!validKey("Escape") && !validKey("Tab") && !validKey("<script>"));
});

test("binding a used key unbinds the other action; only changes are saved", () => {
  const { keys, unbound } = bind(DEFAULT_HOTKEYS, "ok", "E");
  assert.equal(keys.ok, "E");
  assert.equal(unbound, "autoEndOfTurn");
  assert.equal(keys.autoEndOfTurn, "");
  assert.deepEqual(changedKeys(keys), { ok: "E", autoEndOfTurn: "" });
  assert.deepEqual(withDefaults(changedKeys(keys)), keys);
  assert.deepEqual(withDefaults({ ok: "Escape", nope: "Q" }), DEFAULT_HOTKEYS);
});
