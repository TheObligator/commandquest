// Keeping localStorage from filling up and breaking sign-in (src/app/storageRoom.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { capJson, setItemMakingRoom } from "../src/app/storageRoom.ts";

/** A Storage that holds at most `limit` characters (keys plus values), like a browser's quota. */
function fakeStorage(limit: number, items: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(items));
  const used = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem(k: string, v: string) {
      const old = m.get(k);
      if (used() - (old === undefined ? 0 : k.length + old.length) + k.length + v.length > limit) {
        throw new DOMException("full", "QuotaExceededError");
      }
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

test("a session still saves when the card caches have filled storage", () => {
  const s = fakeStorage(1000, { "cq.scryfall.cards.v6": "x".repeat(700), "cq.cardtags.v1": "y".repeat(200), "cq.hotkeys": "{}" });
  setItemMakingRoom(s, "__convexAuthJWT_x", "t".repeat(300));
  assert.equal(s.getItem("__convexAuthJWT_x"), "t".repeat(300));
  assert.equal(s.getItem("cq.scryfall.cards.v6"), null);
  assert.equal(s.getItem("cq.cardtags.v1"), null);
  assert.equal(s.getItem("cq.hotkeys"), "{}", "settings aren't caches: kept");
});

test("caches are left alone when there's room", () => {
  const s = fakeStorage(1000, { "cq.scryfall.cards.v6": "x".repeat(100) });
  setItemMakingRoom(s, "k", "v");
  assert.equal(s.getItem("cq.scryfall.cards.v6"), "x".repeat(100));
});

test("still throws when it can't fit even without the caches", () => {
  const s = fakeStorage(10);
  assert.throws(() => setItemMakingRoom(s, "k", "v".repeat(50)));
});

test("capJson keeps the newest items that fit", () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ i, pad: "z".repeat(50) }));
  const json = capJson(items, 2000);
  assert.ok(json.length <= 2000);
  const kept = JSON.parse(json) as { i: number }[];
  assert.ok(kept.length > 20, `kept ${kept.length}`);
  assert.deepEqual(kept.map((x) => x.i), items.slice(0, kept.length).map((x) => x.i));
  assert.equal(capJson(items, 1e6), JSON.stringify(items), "under the cap: everything");
});
