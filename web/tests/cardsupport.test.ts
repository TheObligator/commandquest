import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { BROKEN_FILE, CARDS_DIR, OUT_FILE, buildSupport, render, scriptNames } from "../scripts/cardsupport.ts";
import { CardSupport, type CardSupportData } from "../src/cardsupport.ts";
import type { ScryCard } from "../src/scryfall.ts";

test("scriptNames reads the card's name, and both halves of a split card", () => {
  assert.deepEqual(scriptNames("Name:Sol Ring\r\nManaCost:1\r\nTypes:Artifact\r\n"), ["Sol Ring"]);
  assert.deepEqual(scriptNames("Name:Delver of Secrets\nAlternateMode:DoubleFaced\nALTERNATE\nName:Insectile Aberration\n"), ["Delver of Secrets"]);
  assert.deepEqual(scriptNames("Name:Fire\nAlternateMode:Split\nALTERNATE\nName:Ice\n"), ["Fire", "Fire // Ice"]);
  assert.deepEqual(scriptNames("Types:Artifact\n"), []);
});

const data: CardSupportData = {
  cards: ["Sol Ring", "Delver of Secrets", "Fire", "Fire // Ice", "All Good Things . . .", "Human-Time Lord Meta-Crisis", "Shahrazad"],
  broken: { Shahrazad: "Subgames aren't supported." },
};
const card = (name: string, faces?: string[]) => ({ name, card_faces: faces?.map((n) => ({ name: n })) }) as unknown as ScryCard;

test("cards Forge has work; reprints match by name whatever the printing", () => {
  const s = new CardSupport(data);
  assert.deepEqual(s.status("Sol Ring"), { works: true });
  assert.deepEqual(s.status(card("sol ring")), { works: true });
  assert.deepEqual(s.status(card("Delver of Secrets // Insectile Aberration", ["Delver of Secrets", "Insectile Aberration"])), { works: true });
  assert.deepEqual(s.status("Delver of Secrets // Insectile Aberration"), { works: true });
  assert.deepEqual(s.status(card("Fire // Ice", ["Fire", "Ice"])), { works: true });
});

test("a card Forge doesn't have, like a brand-new one, is marked", () => {
  const s = new CardSupport(data);
  const st = s.status(card("Some Card From Next Week"));
  assert.equal(st.works, false);
  assert.ok(!st.works && st.missing);
  assert.ok(s.notInForge("Some Card From Next Week"));
});

test("known-broken cards are marked with the reason, but can still start a game", () => {
  const s = new CardSupport(data);
  assert.deepEqual(s.status("Shahrazad"), { works: false, missing: false, reason: "Subgames aren't supported." });
  assert.equal(s.notInForge("Shahrazad"), false);
});

test("Scryfall's punctuation matches Forge's, and the game server gets Forge's spelling", () => {
  const s = new CardSupport(data);
  assert.deepEqual(s.status("All Good Things..."), { works: true });
  assert.deepEqual(s.status("Human—Time Lord Meta-Crisis"), { works: true });
  assert.equal(s.forgeName("All Good Things..."), "All Good Things . . .");
  assert.equal(s.forgeName("Sol Ring"), "Sol Ring");
  assert.equal(s.forgeName("Unknown Card"), "Unknown Card");
});

// Forge's files aren't in CI's sparse checkout; locally this catches a stale public/card-support.json.
test("public/card-support.json is up to date with Forge's cards (run `npm run cardsupport`)", { skip: !existsSync(CARDS_DIR) && "Forge's cardsfolder isn't checked out" }, () => {
  assert.ok(readFileSync(OUT_FILE, "utf8") === render(buildSupport(CARDS_DIR, BROKEN_FILE)), "public/card-support.json is stale: run `npm run cardsupport`");
});

test("public/card-support.json lists Forge's cards", () => {
  const d = JSON.parse(readFileSync(OUT_FILE, "utf8")) as CardSupportData;
  assert.ok(d.cards.length > 30000);
  const s = new CardSupport(d);
  for (const n of ["Sol Ring", "Command Tower", "Forest", "Fire // Ice", "Delver of Secrets"]) assert.ok(s.status(n).works, n);
});
