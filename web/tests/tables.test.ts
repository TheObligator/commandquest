// Rules behind multiplayer tables (convex/model/tables.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aiSeats,
  cantStart,
  checkSettings,
  CODE_LENGTH,
  defaultSettings,
  GAME_KEY_RE,
  makeCode,
  makeGameKey,
  nextHost,
  parseCode,
  TableError,
} from "../convex/model/tables.ts";

const bytes = (n: number, f: (i: number) => number) => Uint8Array.from({ length: n }, (_, i) => f(i));

test("invite codes avoid look-alike characters and parse back from a code or a link", () => {
  const code = makeCode(bytes(16, (i) => i * 37));
  assert.equal(code.length, CODE_LENGTH);
  assert.doesNotMatch(code, /[01OIL]/);
  assert.equal(parseCode(code), code);
  assert.equal(parseCode(code.toLowerCase()), code);
  assert.equal(parseCode(`https://commandquest.app/#/join/${code}`), code);
  assert.equal(parseCode(`  ${code.slice(0, 5)}-${code.slice(5)} `), code);
  assert.equal(parseCode("short"), null);
  assert.equal(parseCode("0000000000"), null);
  assert.equal(parseCode(""), null);
});

test("game keys are 128 random bits in hex", () => {
  const key = makeGameKey(bytes(16, (i) => i * 17));
  assert.match(key, GAME_KEY_RE);
  assert.equal(key.slice(0, 4), "0011");
  assert.throws(() => makeGameKey(new Uint8Array(4)));
});

test("settings are checked and tidied, and must still fit the players seated", () => {
  const base = defaultSettings("Ana");
  assert.equal(base.name, "Ana's table");
  assert.equal(checkSettings({ name: "  Friday   night " }, base).name, "Friday night");
  assert.equal(checkSettings({ seats: 2 }, base, 2).seats, 2);
  for (const bad of [{ name: "" }, { name: "x".repeat(41) }, { seats: 1 }, { seats: 5 }, { seats: 2.5 }, { rewind: 5 }, { rewind: -1 }]) {
    assert.throws(() => checkSettings(bad, base), TableError);
  }
  assert.throws(() => checkSettings({ seats: 2 }, base, 3), /at least 3 seats/);
});

test("a leaving host is replaced by a random player still seated", () => {
  const rest = ["b", "c", "d"];
  assert.equal(nextHost(rest, 0), "b");
  assert.equal(nextHost(rest, 0.5), "c");
  assert.equal(nextHost(rest, 0.9999), "d");
  assert.equal(nextHost(rest, 1), "d"); // never past the end
  assert.equal(nextHost([], 0.3), null);
});

test("the host can start once everyone has a deck and the others are ready", () => {
  const ai = { seats: 4, fillWithAI: true };
  const host = { userId: "h", deckId: "d1", ready: false };
  assert.equal(cantStart([host], "h", ai), null); // the host alone, with AI
  assert.match(cantStart([host], "h", { seats: 4, fillWithAI: false })!, /Invite someone/);
  assert.match(cantStart([{ ...host, deckId: undefined }], "h", ai)!, /hasn't picked a deck/);
  assert.match(cantStart([host, { userId: "b", deckId: "d2", ready: false }], "h", ai)!, /Waiting for a player/);
  assert.equal(cantStart([host, { userId: "b", deckId: "d2", ready: true }], "h", ai), null);
  assert.match(cantStart([], "h", ai)!, /Nobody/);
});

test("empty seats get AI only when the table fills them", () => {
  assert.equal(aiSeats(2, { seats: 4, fillWithAI: true }), 2);
  assert.equal(aiSeats(4, { seats: 4, fillWithAI: true }), 0);
  assert.equal(aiSeats(2, { seats: 4, fillWithAI: false }), 0);
});
