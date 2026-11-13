// Replay keeping rules and the game server's upload description (convex/model/replays.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cantSave, decodeBase64Url, MAX_RECENT, MAX_SAVED, parseReplayMeta, recentToDrop, ReplayError, sameSecret } from "../convex/model/replays.ts";

test("only the newest five unsaved replays are kept; saved ones never go", () => {
  const links = [
    ...Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, saved: false, playedAt: i })),
    { id: "s", saved: true, playedAt: -1 },
  ];
  const drop = recentToDrop(links).map((l) => l.id).sort();
  assert.equal(MAX_RECENT, 5);
  assert.deepEqual(drop, ["r0", "r1"]);
});

test("a sixth saved game needs a delete first", () => {
  assert.equal(cantSave(MAX_SAVED - 1), null);
  assert.match(cantSave(MAX_SAVED) ?? "", /already have 5 saved games/);
});

test("parseReplayMeta keeps what's usable and clips the rest", () => {
  const m = parseReplayMeta({
    title: "You vs AI 1",
    playedAt: 1700000000000,
    turns: 9.7,
    frames: 120,
    players: [{ name: "You", human: true, commander: "Isamaru, Hound of Konda" }, { name: "AI 1", human: false }],
    winner: "You",
    users: ["k57abc", 42],
    extra: "ignored",
  });
  assert.deepEqual(m, {
    title: "You vs AI 1",
    playedAt: 1700000000000,
    turns: 9,
    frames: 120,
    players: [{ name: "You", human: true, commander: "Isamaru, Hound of Konda" }, { name: "AI 1", human: false }],
    winner: "You",
    users: ["k57abc"],
  });
  assert.throws(() => parseReplayMeta({ players: [{ name: "x" }], users: ["u"] }), ReplayError);
  assert.throws(() => parseReplayMeta({ players: [{ name: "a" }, { name: "b" }], users: [] }), ReplayError);
});

test("the upload header decodes from base64url, accents included", () => {
  const json = JSON.stringify({ title: "Jöran vs AI 1 ✓" });
  const encoded = Buffer.from(json, "utf8").toString("base64url");
  assert.equal(decodeBase64Url(encoded), json);
});

test("sameSecret", () => {
  assert.ok(sameSecret("Bearer abc", "Bearer abc"));
  assert.ok(!sameSecret("Bearer abd", "Bearer abc"));
  assert.ok(!sameSecret(null, "Bearer abc"));
  assert.ok(!sameSecret("Bearer ab", "Bearer abc"));
});
