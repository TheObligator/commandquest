// The "default printing" setting's choice among a card's printings (src/printings.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { choosePrinting, isPlainFrame, isRegular, price, type Print } from "../src/printings.ts";

const p = (id: string, released_at: string, extra: Partial<Print> = {}): Print => ({
  id, set: id, set_type: "expansion", collector_number: "1", released_at, border_color: "black", ...extra,
});

const solRing = [
  p("plst", "2024-01-01", { set_type: "masters", prices: { usd: "0.50" } }), // The List
  p("sld", "2023-06-01", { set_type: "box", prices: { usd: "9.00" } }), // Secret Lair
  p("prm", "2023-05-01", { set_type: "promo", promo: true, prices: { usd: "1.00" } }),
  p("cmm-borderless", "2023-08-04", { set: "cmm", set_type: "masters", border_color: "borderless", prices: { usd: "3.00" } }),
  p("cmm", "2023-08-04", { set_type: "masters", prices: { usd: "1.20" } }),
  p("c21", "2021-04-23", { set_type: "commander", prices: { usd: "1.10" } }),
  p("lea", "1993-08-05", { set_type: "core", prices: { usd: "3000" } }),
  p("mtgo", "2025-01-01", { digital: true }),
];

test("newest regular printing skips promos, The List, Secret Lair, alternate frames and digital", () => {
  assert.equal(choosePrinting(solRing, "newest")?.id, "cmm");
});

test("original printing is the first normal one", () => {
  assert.equal(choosePrinting(solRing, "oldest")?.id, "lea");
});

test("cheapest is the lowest price, whatever the printing", () => {
  assert.equal(choosePrinting(solRing, "cheapest")?.id, "plst");
});

test("cheapest uses any finish's price, and breaks ties toward the newest regular printing", () => {
  const prints = [
    p("old", "2010-01-01", { prices: { usd: "0.25" } }),
    p("foil-only", "2022-01-01", { prices: { usd_foil: "0.25" } }),
    p("promo", "2024-01-01", { promo: true, prices: { usd: "0.25" } }),
    p("dear", "2023-01-01", { prices: { usd: "5" } }),
  ];
  assert.equal(choosePrinting(prints, "cheapest")?.id, "foil-only");
});

test("cheapest with no prices falls back to the newest regular printing", () => {
  assert.equal(choosePrinting([p("a", "2020-01-01"), p("b", "2021-01-01")], "cheapest")?.id, "b");
});

test("a card only printed as promos still gets one", () => {
  const prints = [p("p1", "2019-01-01", { promo: true }), p("p2", "2020-01-01", { promo: true })];
  assert.equal(choosePrinting(prints, "newest")?.id, "p2");
  assert.equal(choosePrinting(prints, "oldest")?.id, "p1");
});

test("Scryfall's default and no printings pick nothing", () => {
  assert.equal(choosePrinting(solRing, "default"), undefined);
  assert.equal(choosePrinting([], "newest"), undefined);
});

test("full-art basics are plain; other full art isn't", () => {
  assert.ok(isPlainFrame(p("x", "2020-01-01", { full_art: true, type_line: "Basic Land — Forest" })));
  assert.ok(!isPlainFrame(p("x", "2020-01-01", { full_art: true, type_line: "Legendary Creature" })));
  assert.ok(!isRegular(p("sld", "2020-01-01", { set_type: "box" })));
  assert.equal(price(p("x", "2020-01-01", { prices: { usd: null, usd_foil: "2.5" } })), 2.5);
});

test("newest skips retro-frame reprints, Universes Beyond and printings not out yet", () => {
  const prints = [
    p("future", "2099-01-01"),
    p("ub", "2026-11-13", { promo_types: ["universesbeyond"] }),
    p("retro", "2025-01-24", { frame: "1997" }),
    p("inr", "2025-01-24", { frame: "2015" }),
    p("isd", "2011-09-30", { frame: "2003" }),
  ];
  assert.equal(choosePrinting(prints, "newest", "2026-11-16")?.id, "inr");
  assert.equal(choosePrinting(prints, "oldest", "2026-11-16")?.id, "isd");
  assert.equal(choosePrinting([p("ub", "2026-11-13", { promo_types: ["universesbeyond"] })], "newest", "2026-11-16")?.id, "ub");
  assert.equal(choosePrinting([p("future", "2099-01-01")], "newest", "2026-11-16")?.id, "future", "only unreleased: still one");
});

test("newest skips Japanese alternate art, Masterpieces and white borders; Universes Beyond-only cards get a plain one", () => {
  const jace = [
    p("war-ja", "2019-05-03", { set: "war", collector_number: "54★", lang: "ja", promo_types: ["jpwalker"] }),
    p("war", "2019-05-03", { collector_number: "54" }),
  ];
  assert.equal(choosePrinting(jace, "newest", "2026-11-16")?.id, "war");
  const grindstone = [p("mps", "2016-09-30", { set_type: "masterpiece" }), p("tmp", "1997-10-14", { frame: "1997" })];
  assert.equal(choosePrinting(grindstone, "newest", "2026-11-16")?.id, "tmp");
  const bolt = [p("4ed", "1995-04-01", { border_color: "white", frame: "1993" }), p("m10", "2009-07-17", { frame: "2003" })];
  assert.equal(choosePrinting([p("lea", "1993-08-05"), ...bolt], "newest", "2026-11-16")?.id, "m10");
  const ring = [
    p("hoc", "2026-08-14", { set_type: "eternal", border_color: "borderless", promo_types: ["surgefoil", "universesbeyond"] }),
    p("ltr", "2023-06-23", { promo_types: ["universesbeyond"] }),
  ];
  assert.equal(choosePrinting(ring, "newest", "2026-11-16")?.id, "ltr");
});

test("the futureshifted frame counts only on Future Sight itself", () => {
  const counterspell = [p("mb2", "2024-08-02", { frame: "future" }), p("dmr", "2023-01-13", { frame: "2015" })];
  assert.equal(choosePrinting(counterspell, "newest", "2026-11-16")?.id, "dmr");
  const tarmogoyf = [p("fut", "2007-05-04", { frame: "future" }), p("mb2-goyf", "2024-08-02", { set: "mb2", frame: "future" })];
  assert.equal(choosePrinting(tarmogoyf, "oldest", "2026-11-16")?.id, "fut");
});
