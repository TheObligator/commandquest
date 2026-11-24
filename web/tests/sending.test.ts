import { test } from "node:test";
import assert from "node:assert/strict";
import { GIVE_UP_MS, SHOW_MS, Sending, STILL_MS, type Clock, type Sent } from "../src/game/sending.ts";

/** A clock that moves when told to. */
function fake() {
  let now = 0;
  let n = 0;
  const jobs = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    set: (fn, ms) => (jobs.set(++n, { at: now + ms, fn }), n),
    clear: (id) => void jobs.delete(id),
  };
  const go = (ms: number) => {
    now += ms;
    for (const [id, j] of [...jobs].sort((a, z) => a[1].at - z[1].at)) if (j.at <= now && jobs.delete(id)) j.fn();
  };
  const shown: (Sent | null)[] = [];
  let gaveUp = 0;
  const s = new Sending((x) => shown.push(x), () => gaveUp++, clock);
  return { s, go, shown, waiting: () => jobs.size, gaveUp: () => gaveUp };
}

test("a quick answer shows nothing, but the press is held until it comes", () => {
  const f = fake();
  f.s.begin("ok");
  assert.equal(f.s.busy, true);
  f.go(SHOW_MS - 1);
  f.s.heard("waiting");
  assert.equal(f.s.busy, false);
  f.go(GIVE_UP_MS);
  assert.deepEqual(f.shown, []);
  assert.equal(f.gaveUp(), 0);
});

test("a slow answer shows which button is waiting, then that it's slow", () => {
  const f = fake();
  f.s.begin("cancel");
  f.go(SHOW_MS);
  assert.deepEqual(f.shown.at(-1), { what: "cancel", slow: false });
  f.go(STILL_MS - SHOW_MS);
  assert.deepEqual(f.shown.at(-1), { what: "cancel", slow: true });
  f.s.heard("prompt");
  assert.equal(f.shown.at(-1), null);
  assert.equal(f.waiting(), 0);
});

test("state updates and other chatter don't release a prompt's button", () => {
  const f = fake();
  f.s.begin("ok");
  for (const t of ["state", "pong", "details", "actions", "shown", "libraryCards"]) f.s.heard(t);
  assert.equal(f.s.busy, true);
  for (const t of ["prompt", "waiting", "ask", "over", "notice", "error"]) {
    f.s.begin("ok");
    f.s.heard(t);
    assert.equal(f.s.busy, false, t);
  }
});

test("a question's answer is also done when the game moves on", () => {
  const f = fake();
  f.s.begin("answer", true);
  f.s.heard("pong");
  assert.equal(f.s.busy, true);
  f.s.heard("state");
  assert.equal(f.s.busy, false);
});

test("no answer at all: you can press it again, and are told so once", () => {
  const f = fake();
  f.s.begin("ok");
  f.go(GIVE_UP_MS);
  assert.equal(f.s.busy, false);
  assert.equal(f.shown.at(-1), null);
  assert.equal(f.gaveUp(), 1);
  f.go(GIVE_UP_MS);
  assert.equal(f.gaveUp(), 1);
});

test("a lost connection drops the wait without saying that it failed", () => {
  const f = fake();
  f.s.begin("ok");
  f.go(SHOW_MS);
  f.s.clear();
  f.go(GIVE_UP_MS);
  assert.equal(f.shown.at(-1), null);
  assert.equal(f.gaveUp(), 0);
});
