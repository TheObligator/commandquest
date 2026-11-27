import { test } from "node:test";
import assert from "node:assert/strict";
import type { DeckCard } from "../convex/model/deckRules.ts";
import {
  cleanColors,
  cleanComment,
  colorsMatch,
  CommentError,
  deckCardKeys,
  deckMatches,
  isShared,
  keyDiff,
  makeShareKey,
  SHARE_KEY_RE,
  threads,
  visibilityOf,
} from "../convex/model/sharing.ts";
import { cardDiff, continues, CHANGE_GAP_MS, describeCards, fieldChanges, mergeCards, mergeFields } from "../convex/model/changelog.ts";

const card = (name: string, board: DeckCard["board"] = "main", quantity = 1): DeckCard => ({ name, board, quantity });

test("decks saved before sharing existed are private", () => {
  assert.equal(visibilityOf(undefined), "private");
  assert.equal(visibilityOf("unlisted"), "unlisted");
  assert.equal(isShared(undefined), false);
  assert.equal(isShared("public"), true);
});

test("share keys are 10 unambiguous characters", () => {
  const key = makeShareKey(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 255]));
  assert.match(key, SHARE_KEY_RE);
  assert.ok(!/[01IlO]/.test(key));
  assert.throws(() => makeShareKey(new Uint8Array(4)));
});

test("a deck's card keys cover both faces and skip the maybeboard", () => {
  const keys = deckCardKeys([card("Sol Ring"), card("Delver of Secrets // Insectile Aberration"), card("Atraxa", "commander"), card("Maybe Card", "maybe"), card("sol  ring", "side")]);
  assert.deepEqual(keys.sort(), ["atraxa", "delver of secrets", "delver of secrets // insectile aberration", "insectile aberration", "sol ring"]);
});

test("keyDiff adds and removes only what changed", () => {
  assert.deepEqual(keyDiff(["a", "b"], ["b", "c"]), { add: ["c"], remove: ["a"] });
});

test("colors: tidied to WUBRG order, and matched exactly, including or within", () => {
  assert.equal(cleanColors("gwx"), "WG");
  assert.equal(cleanColors("C"), "");
  assert.equal(colorsMatch("WUBG", "WUBG", "exact"), true);
  assert.equal(colorsMatch("WUBG", "WU", "exact"), false);
  assert.equal(colorsMatch("WUBG", "WU", "including"), true);
  assert.equal(colorsMatch("WU", "WUB", "within"), true);
  assert.equal(colorsMatch("", "", "exact"), true);
  assert.equal(colorsMatch(undefined, "W", "including"), false);
});

test("deckMatches checks every filter that's set", () => {
  const d = { name: "Atraxa Superfriends", format: "commander", colors: "WUBG", bracket: 3, author: "obligator", cards: [card("Atraxa, Praetors' Voice", "commander"), card("Doubling Season"), card("Oath of Teferi")] };
  assert.ok(deckMatches(d, {}));
  assert.ok(deckMatches(d, { text: "superfriends" }));
  assert.ok(deckMatches(d, { text: "OBLIG" }));
  assert.ok(!deckMatches(d, { text: "goblins" }));
  assert.ok(deckMatches(d, { commander: "atraxa" }));
  assert.ok(deckMatches(d, { cards: ["doubling season", "Oath of Teferi"] }));
  assert.ok(!deckMatches(d, { cards: ["Doubling Season", "Sol Ring"] }));
  assert.ok(deckMatches(d, { colors: "WUBG", colorMatch: "exact", bracket: 3, format: "commander" }));
  assert.ok(!deckMatches(d, { bracket: 4 }));
  assert.ok(!deckMatches(d, { format: "standard" }));
  assert.ok(!deckMatches(d, { colors: "" }), "colorless only");
});

test("comments are trimmed, and empty or long ones are refused", () => {
  assert.equal(cleanComment("  hi\r\n\n\n\nthere  "), "hi\n\nthere");
  assert.throws(() => cleanComment("   "), CommentError);
  assert.throws(() => cleanComment("x".repeat(2001)), CommentError);
});

test("threads: newest comments first, replies under their parent oldest first", () => {
  const t = threads([
    { _id: "a", createdAt: 1 },
    { _id: "b", createdAt: 2 },
    { _id: "a2", parentId: "a", createdAt: 4 },
    { _id: "a1", parentId: "a", createdAt: 3 },
    { _id: "a1x", parentId: "a1", createdAt: 5 },
    { _id: "orphan", parentId: "gone", createdAt: 6 },
  ]);
  assert.deepEqual(t.map((n) => n.comment._id), ["orphan", "b", "a"]);
  const a = t[2];
  assert.deepEqual(a.replies.map((n) => n.comment._id), ["a1", "a2"]);
  assert.deepEqual(a.replies[0].replies.map((n) => n.comment._id), ["a1x"]);
});

test("changelog: card changes are net, and cancel out", () => {
  const diff = cardDiff([card("Sol Ring"), card("Island", "main", 10)], [card("Island", "main", 8), card("Arcane Signet")]);
  assert.deepEqual(diff.sort((a, b) => a.name.localeCompare(b.name)), [
    { board: "main", name: "Arcane Signet", delta: 1 },
    { board: "main", name: "Island", delta: -2 },
    { board: "main", name: "Sol Ring", delta: -1 },
  ]);
  const merged = mergeCards(diff, [{ board: "main", name: "Sol Ring", delta: 1 }, { board: "side", name: "Negate", delta: 1 }]);
  assert.deepEqual(merged.map((c) => c.name).sort(), ["Arcane Signet", "Island", "Negate"]);
});

test("changelog: a field keeps where it started and goes once it's back", () => {
  const f = fieldChanges({ name: "A", format: "commander" }, { name: "B", format: "commander", bracket: 3 });
  assert.deepEqual(f, [{ field: "name", from: "A", to: "B" }, { field: "bracket", from: "", to: "3" }]);
  assert.deepEqual(mergeFields(f, [{ field: "name", from: "B", to: "C" }]), [{ field: "name", from: "A", to: "C" }, { field: "bracket", from: "", to: "3" }]);
  assert.deepEqual(mergeFields([{ field: "name", from: "A", to: "B" }], [{ field: "name", from: "B", to: "A" }]), []);
});

test("changelog: an entry stays open for an hour after the last edit", () => {
  assert.ok(continues(0, CHANGE_GAP_MS - 1));
  assert.ok(!continues(0, CHANGE_GAP_MS));
});

test("changelog: cards moved between boards show as moves", () => {
  const d = describeCards([{ name: "Negate", board: "main", delta: -1 }, { name: "Negate", board: "side", delta: 2 }, { name: "Sol Ring", board: "main", delta: 1 }]);
  assert.deepEqual(d.moved, [{ name: "Negate", from: "main", to: "side", count: 1 }]);
  assert.deepEqual(d.added.map((c) => [c.name, c.board, c.delta]), [["Negate", "side", 1], ["Sol Ring", "main", 1]]);
  assert.deepEqual(d.removed, []);
});
