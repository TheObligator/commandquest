import { test } from "node:test";
import assert from "node:assert/strict";
import { searchFiles } from "../scripts/searchfiles.ts";

test("the public site is indexed, with a sitemap and a canonical address", () => {
  const f = searchFiles("production");
  assert.match(f.robots, /^Allow: \/$/m);
  assert.match(f.robots, /^Sitemap: https:\/\/commandquest\.app\/sitemap\.xml$/m);
  assert.match(f.sitemap ?? "", /<loc>https:\/\/commandquest\.app\/<\/loc>/);
  assert.match(f.head, /rel="canonical" href="https:\/\/commandquest\.app\/"/);
  assert.doesNotMatch(f.head, /noindex/);
});

test("staging and local builds ask not to be indexed, and don't block the crawl that reads that", () => {
  for (const mode of ["staging", "development"]) {
    const f = searchFiles(mode);
    assert.match(f.head, /<meta name="robots" content="noindex/);
    assert.doesNotMatch(f.robots, /Disallow|Sitemap/);
    assert.equal(f.sitemap, undefined);
  }
});
