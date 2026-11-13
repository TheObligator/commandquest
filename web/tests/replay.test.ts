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
