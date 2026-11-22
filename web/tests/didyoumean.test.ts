import assert from "node:assert/strict";
import { test } from "node:test";
import { distance, editDistance, probes, rank } from "../src/didyoumean.ts";

test("edit distance counts a swapped pair of letters as one edit", () => {
  assert.equal(editDistance("tihte", "tithe"), 1);
  assert.equal(editDistance("bolt", "bolt"), 0);
  assert.equal(editDistance("", "abc"), 3);
});

test("distance ignores case and punctuation, and allows a partial name", () => {
  assert.equal(distance("atraxa praetors voice", "Atraxa, Praetors' Voice"), 0);
  assert.ok(distance("sol rign", "Sol Ring") <= 1);
  assert.ok(distance("cyclonic rif", "Cyclonic Rift") <= 1);
  assert.ok(distance("delver", "Delver of Secrets // Insectile Aberration") < 1);
});

test("probes drop trailing letters and try longer words alone", () => {
  assert.deepEqual(probes("smothering tihe"), ["smothering tih", "smothering ti", "smothering t", "smothering", "tihe"]);
  assert.deepEqual(probes("sol"), []);
});

test("rank keeps close names, closest first, and drops far ones", () => {
  const got = rank("lightening bolt", ["Lightning Bolt", "Lightning Helix", "Bolt Bend", "Chain Lightning"]);
  assert.equal(got[0], "Lightning Bolt");
  assert.ok(!got.includes("Bolt Bend"));
  assert.deepEqual(rank("zzzqqq", ["Sol Ring"]), []);
});

test("rank skips art-series names whose two faces are the same card", () => {
  assert.deepEqual(rank("sol rign", ["Sol Ring", "Sol Ring // Sol Ring"]), ["Sol Ring"]);
});
