import { test } from "node:test";
import assert from "node:assert/strict";
import { isNewBuild, parseBuildId } from "../src/version.ts";

test("parseBuildId reads the build id", () => {
  assert.equal(parseBuildId('{"build":"abc-123"}'), "abc-123");
});

test("parseBuildId ignores anything that isn't a version file", () => {
  assert.equal(parseBuildId("<!doctype html><html></html>"), null);
  assert.equal(parseBuildId("{}"), null);
  assert.equal(parseBuildId('{"build":""}'), null);
  assert.equal(parseBuildId('{"build":42}'), null);
  assert.equal(parseBuildId("null"), null);
  assert.equal(parseBuildId(""), null);
});

test("isNewBuild only when a different real id is served", () => {
  assert.equal(isNewBuild("a", '{"build":"b"}'), true);
  assert.equal(isNewBuild("a", '{"build":"a"}'), false);
  assert.equal(isNewBuild("a", "Service Unavailable"), false);
});
