import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PRESET, autoPassStatus, nextStep, presetFromStops, shouldStop, stopsFromPreset, toggleForAll, toggleStop,
} from "../src/game/phases.ts";

const opps = ["o1", "o2", "o3"];

test("a new game's stops come from the preset: self for you, opponents for each opponent", () => {
  const s = stopsFromPreset(DEFAULT_PRESET, "me", opps);
  assert.ok(s.get("me")!.has("MAIN1"));
  assert.ok(!s.get("me")!.has("END_OF_TURN"));
  for (const o of opps) assert.ok(s.get(o)!.has("COMBAT_DECLARE_ATTACKERS"));
  // Each opponent has its own set, so changing one leaves the others alone.
  toggleStop(s, "o2", "COMBAT_DECLARE_ATTACKERS");
  assert.ok(!s.get("o2")!.has("COMBAT_DECLARE_ATTACKERS"));
  assert.ok(s.get("o1")!.has("COMBAT_DECLARE_ATTACKERS"));
});

test("untap and cleanup can't have stops", () => {
  const s = stopsFromPreset({ self: ["UNTAP", "CLEANUP", "MAIN1"], opponents: [] }, "me", opps);
  assert.deepEqual([...s.get("me")!], ["MAIN1"]);
  assert.equal(toggleStop(s, "me", "CLEANUP"), false);
  assert.equal(shouldStop(s, { activePlayer: "me", step: "UNTAP", stackNonEmpty: true }), false);
});

test("shouldStop: stops on empty stack, always on a non-empty stack, never while passing the turn", () => {
  const s = stopsFromPreset(DEFAULT_PRESET, "me", opps);
  assert.equal(shouldStop(s, { activePlayer: "o1", step: "COMBAT_DECLARE_ATTACKERS" }), true);
  assert.equal(shouldStop(s, { activePlayer: "o1", step: "MAIN1" }), false);
  assert.equal(shouldStop(s, { activePlayer: "o1", step: "MAIN1", stackNonEmpty: true }), true);
  assert.equal(shouldStop(s, { activePlayer: "me", step: "MAIN1", passingTurn: true }), false);
  assert.equal(shouldStop(s, { activePlayer: "me", step: "MAIN1", passingTurn: true, stackNonEmpty: true }), true);
});

test("toggling a step for all opponents", () => {
  const s = stopsFromPreset({ self: [], opponents: [] }, "me", opps);
  toggleStop(s, "o1", "UPKEEP");
  toggleForAll(s, opps, "UPKEEP"); // not all on yet -> turn on for all
  assert.ok(opps.every((o) => s.get(o)!.has("UPKEEP")));
  toggleForAll(s, opps, "UPKEEP"); // all on -> turn off for all
  assert.ok(opps.every((o) => !s.get(o)!.has("UPKEEP")));
  assert.equal(s.get("me")!.size, 0);
});

test("saving a preset keeps only the opponent stops that every opponent shares", () => {
  const s = stopsFromPreset(DEFAULT_PRESET, "me", opps);
  toggleStop(s, "o3", "END_OF_TURN");
  toggleStop(s, "o1", "UPKEEP");
  const p = presetFromStops(s, "me", opps);
  assert.deepEqual(p.self, DEFAULT_PRESET.self);
  assert.deepEqual(p.opponents, ["COMBAT_BEGIN", "COMBAT_DECLARE_ATTACKERS", "COMBAT_DECLARE_BLOCKERS"]);
});

test("turn structure: steps in order, first strike only when needed, then the next player's untap", () => {
  const order = ["me", "o1"];
  assert.deepEqual(nextStep(order, "me", "COMBAT_DECLARE_BLOCKERS"), { active: "me", step: "COMBAT_DAMAGE" });
  assert.deepEqual(nextStep(order, "me", "COMBAT_DECLARE_BLOCKERS", true), { active: "me", step: "COMBAT_FIRST_STRIKE_DAMAGE" });
  assert.deepEqual(nextStep(order, "me", "CLEANUP"), { active: "o1", step: "UNTAP" });
  assert.deepEqual(nextStep(order, "o1", "CLEANUP"), { active: "me", step: "UNTAP" });
});

test("step ids match Forge's PhaseType constants, in order", async () => {
  const { readFileSync } = await import("node:fs");
  const { STEPS } = await import("../src/game/phases.ts");
  const src = readFileSync(new URL("../../forge-game/src/main/java/forge/game/phase/PhaseType.java", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("public enum PhaseType"), src.indexOf(";", src.indexOf("public enum PhaseType")));
  const forge = [...body.matchAll(/^\s+([A-Z0-9_]+)\(/gm)].map((m) => m[1]);
  assert.deepEqual(STEPS.map((s) => s.id), forge);
});

test("per-seat presets: each opponent starts from its seat, missing seats fall back to opponents", () => {
  const preset = { self: [], opponents: ["END_OF_TURN" as const], seats: [["UPKEEP" as const], ["COMBAT_BEGIN" as const]] };
  const s = stopsFromPreset(preset, "me", opps);
  assert.deepEqual([...s.get("o1")!], ["UPKEEP"]);
  assert.deepEqual([...s.get("o2")!], ["COMBAT_BEGIN"]);
  assert.deepEqual([...s.get("o3")!], ["END_OF_TURN"]);
  const back = presetFromStops(s, "me", opps);
  assert.deepEqual(back.seats, [["UPKEEP"], ["COMBAT_BEGIN"], ["END_OF_TURN"]]);
  assert.deepEqual(back.opponents, []);
});

test("auto-pass: end of turn expires next turn, R stops at this turn's end step, B before your turn", () => {
  const order = ["me", "o1", "o2", "o3"];
  const at = (activePlayer: string, step: Parameters<typeof shouldStop>[1]["step"], turn: number) => ({ activePlayer, step, turn, me: "me", turnOrder: order });
  assert.equal(autoPassStatus({ mode: "END_OF_TURN", turn: 5 }, at("o1", "END_OF_TURN", 5)), "running");
  assert.equal(autoPassStatus({ mode: "END_OF_TURN", turn: 5 }, at("o2", "UPKEEP", 6)), "expired");
  assert.equal(autoPassStatus({ mode: "ACTION_OR_END_STEP", turn: 5 }, at("o1", "COMBAT_DAMAGE", 5)), "running");
  assert.equal(autoPassStatus({ mode: "ACTION_OR_END_STEP", turn: 5 }, at("o1", "END_OF_TURN", 5)), "stop");
  assert.equal(autoPassStatus({ mode: "BEFORE_MY_TURN", turn: 5 }, at("o2", "END_OF_TURN", 6)), "running");
  assert.equal(autoPassStatus({ mode: "BEFORE_MY_TURN", turn: 5 }, at("o3", "END_OF_TURN", 7)), "stop");

  // Through shouldStop: the auto-pass overrides stops, but a non-empty stack still stops.
  const s = stopsFromPreset(DEFAULT_PRESET, "me", ["o1", "o2", "o3"]);
  const ap = { mode: "BEFORE_MY_TURN" as const, turn: 5 };
  assert.equal(shouldStop(s, { ...at("o1", "COMBAT_DECLARE_ATTACKERS", 5), autoPass: ap }), false);
  assert.equal(shouldStop(s, { ...at("o1", "COMBAT_DECLARE_ATTACKERS", 5), autoPass: ap, stackNonEmpty: true }), true);
  assert.equal(shouldStop(s, { ...at("o3", "END_OF_TURN", 7), autoPass: ap }), true);
  // Once expired, the normal stops apply again.
  assert.equal(shouldStop(s, { ...at("o1", "COMBAT_DECLARE_ATTACKERS", 6), autoPass: { mode: "END_OF_TURN", turn: 5 } }), true);
});
