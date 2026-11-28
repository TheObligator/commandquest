import { test } from "node:test";
import assert from "node:assert/strict";
import { retryDelay, retryUrl } from "../src/retry.ts";

test("retries back off to once a minute, and never stop", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 50].map(retryDelay), [2_000, 5_000, 15_000, 30_000, 60_000, 60_000, 60_000]);
});

test("a retry asks for the same picture past any cached failure", () => {
  const src = "https://cards.scryfall.io/normal/front/a/b/ab.jpg?1700000000";
  assert.equal(retryUrl(src, 0), src);
  assert.equal(retryUrl(src, 2), `${src}&retry=2`);
  assert.equal(retryUrl("https://x.test/a.jpg", 1), "https://x.test/a.jpg?retry=1");
  assert.equal(retryUrl("data:image/png;base64,xx", 3), "data:image/png;base64,xx");
});
