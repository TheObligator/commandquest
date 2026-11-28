import assert from "node:assert/strict";
import { test } from "node:test";
import { createQueue, GAPS, QUEUE_KEY, type QueueEnv } from "../src/scryfallQueue.ts";

/** A pretend clock, localStorage and lock shared by several "tabs". */
function device() {
  let now = 1_000_000;
  const store = new Map<string, string>();
  let held = Promise.resolve();
  const env: QueueEnv = {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    lock: (fn) => {
      const run = held.then(fn);
      held = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  return { env, store, at: () => now, advance: (ms: number) => (now += ms) };
}

test("two tabs share one schedule: slow requests 2 per second between them", async () => {
  const d = device();
  const a = createQueue(d.env);
  const b = createQueue(d.env);
  const starts: number[] = [];
  const go = () => {
    starts.push(d.at());
    return Promise.resolve();
  };
  // Sequential so the pretend clock only moves forward.
  for (const q of [a, b, a, b]) await q.run(true, go);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= GAPS.slow, `gap ${i}`);
});

test("a strike in one tab pauses the other, and strikes in a row pause longer", async () => {
  const d = device();
  const a = createQueue(d.env);
  const b = createQueue(d.env);
  assert.equal(await a.strike(), GAPS.backoff);
  assert.equal(b.pauseLeft(), GAPS.backoff);
  // Failures while already paused are the same strike.
  assert.equal(await b.strike(), GAPS.backoff);
  let started = 0;
  await b.run(false, async () => void (started = d.at()));
  assert.ok(started >= 1_000_000 + GAPS.backoff, "waited out the pause");
  assert.equal(await b.strike(), GAPS.backoff * 2);
  d.advance(GAPS.backoff * 2);
  assert.equal(await a.strike(), GAPS.backoff * 4);
  d.advance(GAPS.backoff * 4);
  assert.equal(await a.strike(), GAPS.maxBackoff);
  d.advance(GAPS.maxBackoff);
  assert.equal(await a.strike(), GAPS.maxBackoff, "capped");
  d.advance(GAPS.maxBackoff);
  b.ok();
  await new Promise((r) => setImmediate(r));
  assert.equal(await a.strike(), GAPS.backoff, "a request that worked starts the count again");
});

test("old strikes are forgotten", async () => {
  const d = device();
  const q = createQueue(d.env);
  await q.strike();
  d.advance(GAPS.backoff);
  await q.strike();
  d.advance(GAPS.backoff * 2 + GAPS.forget + 1);
  assert.equal(await q.strike(), GAPS.backoff);
});

test("without storage or locks, a tab keeps its own schedule", async () => {
  const d = device();
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  const q = createQueue({ ...d.env, storage: broken, lock: undefined });
  await q.strike();
  assert.equal(q.pauseLeft(), GAPS.backoff);
  let ran = false;
  await q.run(true, async () => void (ran = true));
  assert.ok(ran);
});

test("a corrupt stored schedule is ignored", async () => {
  const d = device();
  d.store.set(QUEUE_KEY, "{not json");
  const q = createQueue(d.env);
  assert.equal(q.pauseLeft(), 0);
  d.store.set(QUEUE_KEY, JSON.stringify({ any: "soon", paused: null }));
  let ran = false;
  await q.run(false, async () => void (ran = true));
  assert.ok(ran);
});
