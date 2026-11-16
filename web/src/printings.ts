// Which printing a card gets when you don't pick one: the player's "default printing" setting.
// Pure logic, so `node --test` runs it; the Scryfall lookups are in scryfall.ts.

export type PrintingPref = "default" | "newest" | "cheapest" | "oldest";

export const PRINTING_PREFS: { id: PrintingPref; label: string; hint: string }[] = [
  { id: "newest", label: "Newest regular printing", hint: "The latest normal English printing: no promos, The List, Secret Lair, Masterpieces, Universes Beyond, or borderless, white-bordered, showcase, extended-art, retro-frame and alternate-art versions." },
  { id: "cheapest", label: "Cheapest printing", hint: "The lowest Scryfall USD price when you add the card." },
  { id: "oldest", label: "Original printing", hint: "The card's first normal printing." },
  { id: "default", label: "Scryfall's default", hint: "Whatever Scryfall shows for the name, sometimes a promo." },
];

export const DEFAULT_PRINTING_PREF: PrintingPref = "default";

export const isPrintingPref = (x: unknown): x is PrintingPref => PRINTING_PREFS.some((p) => p.id === x);

export const prefLabel = (p: PrintingPref) => PRINTING_PREFS.find((x) => x.id === p)!.label;

/** The Scryfall fields a choice looks at. */
export interface Print {
  id: string;
  set: string;
  set_type?: string;
  collector_number: string;
  released_at?: string;
  promo?: boolean;
  digital?: boolean;
  oversized?: boolean;
  full_art?: boolean;
  border_color?: string;
  frame?: string;
  frame_effects?: string[];
  promo_types?: string[];
  lang?: string;
  type_line?: string;
  prices?: { usd?: string | null; usd_foil?: string | null; usd_etched?: string | null };
}

/** Set types that aren't regular printings. */
const ODD_SET_TYPES = new Set(["promo", "token", "memorabilia", "funny", "minigame", "alchemy", "vanguard", "treasure_chest", "masterpiece"]);
/** The List, its Un- version, and Secret Lair. */
const ODD_SETS = new Set(["plst", "ulst", "sld"]);
const ODD_FRAMES = ["showcase", "extendedart", "etched", "inverted"];

const date = (p: Print) => p.released_at ?? "";

/** A normal English paper printing from a normal set (no Masterpieces, Japanese alternate art, ...). */
export const isRegular = (p: Print) =>
  (p.lang ?? "en") === "en" &&
  !p.promo && !p.digital && !p.oversized && !ODD_SETS.has(p.set) && !ODD_SET_TYPES.has(p.set_type ?? "");

/** The first set with the current (2015) frame; later printings in an older frame are retro variants. */
const MODERN_FRAME_FROM = "2014-07-18";

/**
 * No alternate frame: not borderless, white-bordered, showcase, extended art, retro frame or (except basics) full
 * art, no special treatment (Universes Beyond, serialized, ...) and a plain collector number.
 */
export const isPlainFrame = (p: Print, allowUniversesBeyond = false) =>
  p.border_color !== "borderless" &&
  p.border_color !== "white" &&
  !p.frame_effects?.some((f) => ODD_FRAMES.includes(f)) &&
  (!p.full_art || /\bBasic\b/.test(p.type_line ?? "")) &&
  !(p.frame && p.frame !== "2015" && p.frame !== "future" && date(p) >= MODERN_FRAME_FROM) &&
  // Scryfall tags special treatments (Japanese walkers, galaxy foils, Universes Beyond, ...).
  !p.promo_types?.some((t) => !(allowUniversesBeyond && t === "universesbeyond")) &&
  !/[^\d]/.test(p.collector_number);

/** The lowest USD price Scryfall lists for it (any finish), or null. */
export function price(p: Print): number | null {
  const all = [p.prices?.usd, p.prices?.usd_etched, p.prices?.usd_foil].map((x) => (x ? Number(x) : NaN)).filter((x) => Number.isFinite(x));
  return all.length ? Math.min(...all) : null;
}

/** The first non-empty group, best first. */
function firstTier<T extends Print>(prints: T[], tests: ((p: T) => boolean)[]): T[] {
  for (const t of tests) {
    const hit = prints.filter(t);
    if (hit.length) return hit;
  }
  return prints;
}

const newestOf = <T extends Print>(ps: T[]) => ps.reduce((a, b) => (date(b) > date(a) ? b : a));
const oldestOf = <T extends Print>(ps: T[]) => ps.reduce((a, b) => (date(b) < date(a) ? b : a));

/**
 * The printing `pref` picks from all of a card's printings, or undefined for "default" (Scryfall
 * picks) or no printings. Never fails for a card that has printings: when no printing fits the
 * rule (a card only printed as a promo), it falls back to the closest one.
 */
export function choosePrinting<T extends Print>(prints: T[], pref: PrintingPref, today = new Date().toISOString().slice(0, 10)): T | undefined {
  // Paper printings that are out (Scryfall lists previewed sets before release).
  const pool = firstTier(prints, [(p) => !p.digital && date(p) <= today, (p) => !p.digital]);
  if (!pool.length || pref === "default") return undefined;
  // Best first; a card only printed in Universes Beyond gets its plainest one.
  const tiers = [(p: T) => isRegular(p) && isPlainFrame(p), (p: T) => isRegular(p) && isPlainFrame(p, true), isRegular, (p: T) => !p.oversized];
  if (pref === "newest") return newestOf(firstTier(pool, tiers));
  if (pref === "oldest") return oldestOf(firstTier(pool, tiers));
  // Cheapest: the lowest price among normal-sized printings; ties go to the newest regular one.
  const priced = pool.filter((p) => !p.oversized && price(p) !== null);
  if (!priced.length) return newestOf(firstTier(pool, tiers));
  const low = Math.min(...priced.map((p) => price(p)!));
  return newestOf(firstTier(priced.filter((p) => price(p) === low), tiers));
}
