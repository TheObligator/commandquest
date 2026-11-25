// Reads Commander Spellbook's find-my-combos answer (backend.commanderspellbook.com/schema) into what's
// stored with a deck. Pure, so `npm test` covers it.
import { faceName, type NearCombo, type SpellbookCombo } from "../../src/game/spellbook.ts";

export const MAX_COMBOS = 150;
export const MAX_NEAR = 30;
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");

interface Variant {
  id?: unknown;
  uses?: { card?: { name?: unknown }; zoneLocations?: unknown; quantity?: unknown; mustBeCommander?: unknown }[];
  requires?: { template?: { name?: unknown }; quantity?: unknown }[];
  produces?: { feature?: { name?: unknown } }[];
  manaNeeded?: unknown;
  easyPrerequisites?: unknown;
  notablePrerequisites?: unknown;
  description?: unknown;
}

const list = <T>(x: T[] | undefined) => (Array.isArray(x) ? x : []);
const names = (v: Variant) => list(v.uses).map((u) => clip(u?.card?.name, 200)).filter(Boolean);
const results = (v: Variant) => list(v.produces).map((p) => clip(p?.feature?.name, 120)).filter(Boolean).slice(0, 12);
const idOf = (v: Variant) => (typeof v.id === "string" && v.id.length <= 128 ? v.id : "");

function combo(v: Variant): SpellbookCombo | null {
  const id = idOf(v);
  const cards = list(v.uses).flatMap((u) => {
    const name = clip(u?.card?.name, 200);
    if (!name) return [];
    const zones = list(u.zoneLocations as string[]).filter((z) => /^[HBCEGL]$/.test(z)).join("");
    return [{
      name,
      zones: zones || "B",
      ...(typeof u.quantity === "number" && u.quantity > 1 ? { quantity: Math.min(99, Math.floor(u.quantity)) } : {}),
      ...(u.mustBeCommander === true ? { commander: true } : {}),
    }];
  });
  if (!id || !cards.length) return null;
  const mana = clip(v.manaNeeded, 100);
  const before = [clip(v.easyPrerequisites, 600), clip(v.notablePrerequisites, 600)].filter(Boolean).join("\n");
  return {
    id,
    cards: cards.slice(0, 20),
    needs: list(v.requires).map((t) => clip(t?.template?.name, 120)).filter(Boolean).slice(0, 10),
    results: results(v),
    ...(mana ? { mana } : {}),
    ...(before ? { before } : {}),
    steps: clip(v.description, 6000).split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 40),
  };
}

/** One page of the answer: the deck's combos, and the ones it's a single card away from. `deck`: its card names. */
export function parseCombos(json: unknown, deck: string[]): { combos: SpellbookCombo[]; near: NearCombo[]; more: boolean } {
  const page = (json ?? {}) as { next?: unknown; results?: { included?: Variant[]; almostIncluded?: Variant[] } };
  if (!page.results || !Array.isArray(page.results.included)) throw new Error("Not a find-my-combos answer");
  const have = new Set(deck.map(faceName));
  const near = list(page.results.almostIncluded).flatMap((v): NearCombo[] => {
    const cards = names(v);
    const missing = cards.filter((c) => !have.has(faceName(c)));
    return idOf(v) && missing.length === 1 ? [{ id: idOf(v), cards: cards.slice(0, 20), missing: missing[0], results: results(v) }] : [];
  });
  return {
    combos: page.results.included.map(combo).filter((c): c is SpellbookCombo => !!c),
    near,
    more: typeof page.next === "string",
  };
}
