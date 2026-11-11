import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUsername, displayName, usernameKey } from "../src/username.ts";

const error = (input: string) => {
  const r = checkUsername(input);
  return r.ok ? null : r.error;
};

test("checkUsername accepts letters, digits, _ - and inner spaces, tidying spaces", () => {
  assert.deepEqual(checkUsername("Jace_Beleren-2"), { ok: true, username: "Jace_Beleren-2", key: "jace_beleren-2" });
  assert.deepEqual(checkUsername("  Mind   Sculptor "), { ok: true, username: "Mind Sculptor", key: "mind sculptor" });
  assert.equal(checkUsername("abc").ok, true);
  assert.equal(checkUsername("x".repeat(20)).ok, true);
  assert.equal(checkUsername("Aine").ok, true);
  assert.equal(checkUsername("AIDEN").ok, true);
});

test("checkUsername rejects bad lengths and characters", () => {
  assert.match(error("ab")!, /3–20/);
  assert.match(error("   ab   ")!, /3–20/);
  assert.match(error("x".repeat(21))!, /3–20/);
  assert.match(error("me@example.com")!, /letters, numbers/);
  assert.match(error("Jöhn")!, /letters, numbers/);
  assert.match(error("tab\there")!, /letters, numbers/);
});

test("checkUsername refuses names that look like computer players", () => {
  assert.match(error("AI Bob")!, /AI/);
  assert.match(error("ai bob")!, /AI/);
  assert.match(error("  Ai   Bob")!, /AI/);
});

test("usernames are unique case-insensitively", () => {
  assert.equal(usernameKey("Teferi"), usernameKey("tEFERI"));
});

test("displayName prefers the username, then the provider name, never the email", () => {
  assert.equal(displayName({ username: "Teferi", name: "Jordan" }), "Teferi");
  assert.equal(displayName({ name: "Jordan" }), "Jordan");
  assert.equal(displayName({}), "Player");
  assert.equal(displayName({ name: "  " }), "Player");
  assert.equal(displayName({ name: "AI Overlord" }), "Player");
  assert.equal(displayName({ name: "x".repeat(50) }).length, 40);
  // email-only sign-ins have no name: the email is never used
  assert.equal(displayName({ email: "me@example.com" } as { name?: string }), "Player");
});
