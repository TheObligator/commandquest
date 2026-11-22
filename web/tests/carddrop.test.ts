// Cards dragged in from EDHREC and Scryfall (src/carddrop.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeCard, readDrop } from "../src/carddrop.ts";

/** Just enough of a parsed document for readDrop: img and a elements with attributes and text. */
function fakeDoc(html: string): Document {
  const els = (tag: string) =>
    [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>(?:([\\s\\S]*?)</${tag}>)?`, "g"))].map((m) => ({
      getAttribute: (k: string) => m[1].match(new RegExp(`${k}="([^"]*)"`))?.[1] ?? null,
      textContent: (m[2] ?? "").replace(/<[^>]*>/g, ""),
    }));
  return { querySelectorAll: (tag: string) => els(tag) } as unknown as Document;
}

const ID = "2185c08f-bb4d-49d5-8b6c-c629a48bb61c";

test("an EDHREC card: the Scryfall id from its image, the name from its text", () => {
  const html = `<a class="x" href="/cards/sanctum-lurker"><img alt="" src="https://card-images.edhrec.com/grid/front/2/1/${ID}.webp?1789556729"/><span>Sanctum Lurker</span></a>`;
  assert.deepEqual(readDrop({ html, uris: "https://edhrec.com/cards/sanctum-lurker", text: "https://edhrec.com/cards/sanctum-lurker" }, fakeDoc), {
    id: ID,
    fuzzy: "sanctum lurker",
    name: "Sanctum Lurker",
  });
});

test("an EDHREC link alone gives a name to look up loosely", () => {
  assert.deepEqual(readDrop({ uris: "https://edhrec.com/cards/atraxa-praetors-voice" }), { fuzzy: "atraxa praetors voice" });
  assert.deepEqual(readDrop({ text: "https://www.edhrec.com/commanders/sol-ring" }), { fuzzy: "sol ring" });
});

test("Scryfall images and card pages", () => {
  assert.deepEqual(readDrop({ uris: `https://cards.scryfall.io/normal/front/2/1/${ID.toUpperCase()}.jpg?123` }), { id: ID });
  assert.deepEqual(readDrop({ uris: "# comment\nhttps://scryfall.com/card/cmr/472/sol-ring" }), { set: "cmr", collectorNumber: "472" });
  const html = `<img src="https://cards.scryfall.io/large/front/2/1/${ID}.jpg" alt="Sol Ring">`;
  assert.deepEqual(readDrop({ html }, fakeDoc), { id: ID, name: "Sol Ring" });
});

test("plain text is a card name; other links and junk are nothing", () => {
  assert.deepEqual(readDrop({ text: "  Sol   Ring " }), { name: "Sol Ring" });
  assert.equal(readDrop({ uris: "https://example.com/page" }), null);
  assert.equal(readDrop({ text: "" }), null);
  assert.equal(readDrop({ uris: "javascript:alert(1)" }), null);
});

test("only text drags count, not files", () => {
  assert.equal(looksLikeCard(["text/uri-list", "text/html"]), true);
  assert.equal(looksLikeCard(["Files"]), false);
  assert.equal(looksLikeCard(["Files", "text/plain"]), false);
});
