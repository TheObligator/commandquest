// Reading replay files (src/game/replay.ts), in the format Recording.java writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePatch, parseReplay } from "../src/game/replay.ts";

const meta = { title: "A vs B", playedAt: 1, turns: 2, frames: 4, players: [{ name: "A", human: true }, { name: "B", human: false }] };
const base = {
  turn: 1,
  active: "1",
  step: "MAIN1",
  stack: [],
  gameOver: false,
  cards: { "10": { id: 10, name: "Plains", zone: "hand", owner: "1", controller: "1" }, "20": { id: 20, name: "Mountain", zone: "hand", owner: "2", controller: "2" } },
  players: [
    { id: "1", name: "A", life: 40, hand: [10], battlefield: [], graveyard: [], exile: [], command: [], handCount: 1, libraryCount: 98 },
    { id: "2", name: "B", life: 40, hand: [20], battlefield: [], graveyard: [], exile: [], command: [], handCount: 1, libraryCount: 98 },
  ],
};

test("mergePatch replaces, deletes and shares what didn't change", () => {
  const a = { x: { y: 1, z: 2 }, keep: { deep: true }, gone: 1 };
  const b = mergePatch(a, { x: { y: 3 }, gone: null }) as typeof a;
  assert.deepEqual(b, { x: { y: 3, z: 2 }, keep: { deep: true } });
  assert.equal(b.keep, a.keep, "unchanged parts are shared");
  assert.deepEqual(a.x, { y: 1, z: 2 }, "the original is untouched");
});

test("frames rebuild the table, the log follows, a rewind cuts it", () => {
  const r = parseReplay({
    version: 1,
    meta,
    frames: [
      { ...base, logAdd: ["Turn 1 (A)"] },
      { cards: { "10": { zone: "battlefield" } }, players: [{ ...base.players[0], hand: [], battlefield: [10], handCount: 0 }, base.players[1]], logAdd: ["A played Plains"] },
      { logCut: 1, logAdd: ["Rewound to before A played Plains (asked by A)."], cards: { "10": { zone: "hand" } }, players: base.players },
      { turn: 2, active: "2", logAdd: ["Turn 2 (B)"] },
    ],
  });
  assert.equal(r.length, 4);
  const v1 = r.view(1, "1");
  assert.equal(v1.players[0].battlefield[0].name, "Plains");
  assert.deepEqual(v1.log, ["Turn 1 (A)", "A played Plains"]);
  assert.deepEqual(r.view(2, "1").log, ["Turn 1 (A)", "Rewound to before A played Plains (asked by A)."]);
  assert.deepEqual(r.view(1, "1").log, ["Turn 1 (A)", "A played Plains"], "earlier frames keep their log");
  // seat B at the bottom: everyone's hand is there
  const fromB = r.view(3, "2");
  assert.equal(fromB.viewer, "2");
  assert.equal(fromB.players[0].name, "B");
  assert.equal(fromB.players[1].hand[0].name, "Plains");
  assert.equal(fromB.turn, 2);
  assert.deepEqual(r.added(3), ["Turn 2 (B)"]);
});

test("turnStart jumps between turns", () => {
  const frames = [base, {}, { turn: 2 }, {}, { turn: 3 }].map((f, i) => (i === 0 ? f : { ...f, logAdd: [`f${i}`] }));
  const r = parseReplay({ version: 1, meta, frames });
  assert.equal(r.turnStart(0, 1), 2);
  assert.equal(r.turnStart(2, 1), 4);
  assert.equal(r.turnStart(3, -1), 2, "back to this turn's start");
  assert.equal(r.turnStart(2, -1), 0, "already there: the turn before");
  assert.equal(r.turnStart(4, 1), 4, "the end");
});

test("a newer replay version is refused", () => {
  assert.throws(() => parseReplay({ version: 2, meta, frames: [] }), /newer version/);
});

test("bookmarks: commander cast, big hit, wipe, knockout and winner", () => {
  const p = (over: object, b = base.players[0]) => ({ ...b, commanderCasts: 0, ...over });
  const cmd = { "30": { id: 30, name: "Atraxa", zone: "command", owner: "1", controller: "1", commander: true } };
  const start = { ...base, cards: { ...base.cards, ...cmd }, players: [p({ command: [30] }), p({}, base.players[1])] };
  const r = parseReplay({
    version: 1,
    meta: { ...meta, winner: "A" },
    frames: [
      start,
      { players: [p({ command: [], commanderCasts: 1 }), p({}, base.players[1])], logAdd: ["A casts Atraxa"] },
      { turn: 2, players: [p({ command: [], commanderCasts: 1, battlefield: [1, 2, 3, 4] }), p({ life: 38 }, base.players[1])], logAdd: ["x"] },
      { stack: [{ id: 9, name: "Wrath of God" }], logAdd: ["y"] },
      { stack: [], players: [p({ command: [], commanderCasts: 1, battlefield: [4] }), p({ life: 31 }, base.players[1])], logAdd: ["z"] },
      { players: [p({ command: [], commanderCasts: 1, battlefield: [4] }), p({ life: 0, lost: true }, base.players[1])], logAdd: ["B loses"] },
    ],
  });
  const marks = r.bookmarks();
  assert.deepEqual(marks.map((m) => [m.frame, m.events.map((e) => e.kind)]), [
    [1, ["commander"]],
    [4, ["wipe", "hit"]],
    [5, ["win", "out", "hit"]],
  ]);
  assert.equal(marks[0].events[0].text, "A casts Atraxa");
  assert.equal(marks[1].events[0].text, "Board wipe (Wrath of God): 3 permanents gone");
  assert.equal(marks[1].events[1].text, "B loses 7 life (38 → 31)");
  assert.deepEqual(r.turnStarts(), [{ turn: 1, frame: 0 }, { turn: 2, frame: 2 }]);
});

test("bookmarks skip a rewind", () => {
  const r = parseReplay({
    version: 1,
    meta,
    frames: [
      { ...base, logAdd: ["a"] },
      { players: [base.players[0], { ...base.players[1], life: 30 }], logAdd: ["hit"] },
      { logCut: 1, players: base.players, logAdd: ["Rewound"] },
    ],
  });
  assert.deepEqual(r.bookmarks().map((m) => m.frame), [1], "the rewind's life gain back isn't marked, and the hit is");
});

test("minor marks: spells cast and attacks declared", () => {
  const bear = (over: object) => ({ "40": { id: 40, name: "Bear", zone: "battlefield", owner: "1", controller: "1", ...over } });
  const r = parseReplay({
    version: 1,
    meta,
    frames: [
      { ...base, cards: { ...base.cards, ...bear({}) }, logAdd: ["a"] },
      { stack: [{ id: 7, name: "Shock", kind: "Spell", controller: "2" }, { id: 8, name: "Trigger", kind: "Triggered ability", controller: "1" }], logAdd: ["b"] },
      { stack: [], logAdd: ["c"] },
      { cards: bear({ attacking: "2" }), logAdd: ["d"] },
      { logAdd: ["e"] },
    ],
  });
  assert.deepEqual(r.minorMarks().map((m) => [m.frame, m.events.map((e) => e.text)]), [
    [1, ["B casts Shock"]],
    [3, ["A attacks B with 1 creature"]],
  ]);
});
