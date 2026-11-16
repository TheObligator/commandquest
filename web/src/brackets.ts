// Commander Brackets (Wizards of the Coast, beta; criteria as of the October 2025 update and the
// February 2026 Game Changers list), and the "at a glance" card counts shown beside them.
//
// What the rules say per bracket:
//   1 Exhibition  no Game Changers, no mass land denial, no extra turns, no two-card combos
//   2 Core        no Game Changers, no mass land denial, extra turns only a few and not chained,
//                 no two-card combos
//   3 Upgraded    up to 3 Game Changers, no mass land denial, extra turns not chained,
//                 two-card combos only late in the game
//   4 Optimized   anything legal
//   5 cEDH        anything legal, built for the competitive metagame
// Tutors no longer have a bracket limit (the strongest ones are Game Changers).
//
// Game Changers come from Scryfall's `game_changer` flag. The other counts come from Scryfall
// Tagger's oracle tags (`otag:`), looked up per card in src/cardtags.ts, except fast mana, which
// Tagger has no tag for, so it's the list below. Nothing here can see two-card combos, so the
// player marks those with a reason tag.

export const BRACKETS = [
  { n: 1, name: "Exhibition", short: "theme over power", blurb: "Theme over power. Games go 9+ turns." },
  { n: 2, name: "Core", short: "precon level", blurb: "Precon level: no Game Changers. Games go 8+ turns." },
  { n: 3, name: "Upgraded", short: "up to 3 Game Changers", blurb: "Tuned, up to 3 Game Changers, no early combos. Games go 6+ turns." },
  { n: 4, name: "Optimized", short: "anything legal", blurb: "High power, anything legal. Games go 4+ turns." },
  { n: 5, name: "cEDH", short: "competitive", blurb: "Competitive: built to win as fast as possible." },
] as const;

export const bracketName = (n: number) => BRACKETS.find((b) => b.n === n)?.name ?? "";

/** Reasons a player can pick for why the deck sits where it does. */
export const REASON_TAGS = [
  "Game Changers",
  "Two-card combo",
  "Early win",
  "Mass land denial",
  "Chained extra turns",
  "Many tutors",
  "Fast mana",
  "Stax",
  "Heavy interaction",
  "Tuned mana base",
  "Strong commander",
  "Casual theme",
  "Budget",
] as const;

/** Cards that make more mana than they cost, early: Tagger has no tag for these. */
export const FAST_MANA = new Set(
  [
    "Sol Ring", "Mana Crypt", "Mana Vault", "Grim Monolith", "Basalt Monolith", "Chrome Mox", "Mox Diamond", "Mox Opal",
    "Mox Amber", "Mox Tantalite", "Jeweled Lotus", "Lotus Petal", "Lion's Eye Diamond", "Lotus Bloom", "Ancient Tomb",
    "City of Traitors", "Gemstone Caverns", "Mishra's Workshop", "Gaea's Cradle", "Serra's Sanctum", "Tolarian Academy",
    "Dark Ritual", "Cabal Ritual", "Culling the Weak", "Rite of Flame", "Desperate Ritual", "Pyretic Ritual",
    "Seething Song", "Simian Spirit Guide", "Elvish Spirit Guide", "Carpet of Flowers", "Springleaf Drum",
    "Black Lotus", "Mox Pearl", "Mox Sapphire", "Mox Jet", "Mox Ruby", "Mox Emerald", "Sol Talisman",
  ].map((n) => n.toLowerCase()),
);

export interface GlanceCategory {
  id: string;
  label: string;
  /** Scryfall query for the tag; absent for categories worked out here. */
  query?: string;
  hint: string;
}

/** The counts shown at a glance, in display order. */
export const GLANCE: GlanceCategory[] = [
  { id: "gameChanger", label: "Game Changers", hint: "On the official Game Changers list. Exhibition and Core allow none, Upgraded up to 3." },
  { id: "tutor", label: "Tutors", query: "otag:tutor -otag:ramp -t:land", hint: "Search your library for a card (land searches don't count)." },
  { id: "fastMana", label: "Fast mana", hint: "Cards that make more mana than they cost, early (a fixed list: Sol Ring, Mana Crypt, rituals, Moxen…)." },
  { id: "massLandDenial", label: "Mass land denial", query: "otag:mass-land-denial", hint: "Destroys or locks down many lands. Only Optimized and cEDH allow it." },
  { id: "extraTurn", label: "Extra turns", query: "otag:extra-turn", hint: "Exhibition allows none; Core and Upgraded only a few, never chained." },
  { id: "interaction", label: "Interaction", hint: "Removal, board wipes and counterspells together (each card once)." },
  { id: "removal", label: "Removal", query: "otag:spot-removal", hint: "Removes a single permanent." },
  { id: "boardWipe", label: "Board wipes", query: "otag:board-wipe -otag:mass-land-denial", hint: "Removes many permanents at once." },
  { id: "counterspell", label: "Counterspells", query: "otag:counterspell", hint: "Counters a spell or ability." },
  { id: "ramp", label: "Ramp", query: "otag:ramp", hint: "Puts more mana or lands into play." },
  { id: "draw", label: "Card draw", query: "otag:draw", hint: "Draws cards." },
];

/** Scryfall-tag categories that make up Interaction. */
const INTERACTION = ["removal", "boardWipe", "counterspell"];

export interface GlanceCard {
  name: string;
  quantity: number;
  gameChanger?: boolean;
}

/**
 * The cards in each category. `tagged` holds, per tag category, the lower-cased names Tagger
 * puts in it (categories not looked up yet are simply missing).
 */
export function glance(cards: GlanceCard[], tagged: Map<string, Set<string>>): Map<string, GlanceCard[]> {
  const out = new Map<string, GlanceCard[]>();
  const has = (id: string, c: GlanceCard) => tagged.get(id)?.has(c.name.toLowerCase()) ?? false;
  for (const cat of GLANCE) {
    let match: (c: GlanceCard) => boolean;
    if (cat.id === "gameChanger") match = (c) => !!c.gameChanger;
    else if (cat.id === "fastMana") match = (c) => FAST_MANA.has(c.name.toLowerCase());
    else if (cat.id === "interaction") match = (c) => INTERACTION.some((id) => has(id, c));
    else match = (c) => has(cat.id, c);
    out.set(cat.id, cards.filter(match));
  }
  return out;
}

export const total = (cards: GlanceCard[] | undefined) => (cards ?? []).reduce((n, c) => n + c.quantity, 0);

export interface BracketReason {
  /** The lowest bracket this allows. */
  bracket: number;
  text: string;
}

/**
 * The lowest bracket the deck's cards allow, and why. Two-card combos and how early the deck wins
 * can't be seen from the list, so this is a floor, not a rating.
 */
export function bracketFloor(counts: { gameChangers: number; massLandDenial: number; extraTurns: number }): { bracket: number; reasons: BracketReason[] } {
  const reasons: BracketReason[] = [];
  const { gameChangers: gc, massLandDenial: mld, extraTurns: et } = counts;
  if (gc > 3) reasons.push({ bracket: 4, text: `${gc} Game Changers: Upgraded allows up to 3` });
  else if (gc > 0) reasons.push({ bracket: 3, text: `${gc} Game Changer${gc === 1 ? "" : "s"}: Exhibition and Core allow none` });
  if (mld > 0) reasons.push({ bracket: 4, text: `Mass land denial (${mld}): only Optimized and cEDH allow it` });
  if (et > 0) reasons.push({ bracket: 2, text: `Extra turns (${et}): Exhibition allows none; Core and Upgraded only if they aren't chained` });
  reasons.sort((a, z) => z.bracket - a.bracket);
  return { bracket: Math.max(1, ...reasons.map((r) => r.bracket)), reasons };
}

/** Scryfall rejects longer queries ("unclosed parentheses", because it cut them off). */
export const MAX_QUERY = 900;

/** Quoted for an exact-name search. Scryfall has no escape for `"`, and no card name contains one. */
const exact = (name: string) => `!"${name.replace(/"/g, "")}"`;

/** Splits the names into queries `<prefix> (!"a" or !"b" …)` that each fit in `max` characters. */
export function batchQueries(prefix: string, names: string[], max = MAX_QUERY): { query: string; names: string[] }[] {
  const out: { query: string; names: string[] }[] = [];
  let batch: string[] = [];
  const build = (b: string[]) => `${prefix} (${b.map(exact).join(" or ")})`;
  for (const n of names) {
    if (batch.length && build([...batch, n]).length > max) {
      out.push({ query: build(batch), names: batch });
      batch = [];
    }
    batch.push(n);
  }
  if (batch.length) out.push({ query: build(batch), names: batch });
  return out;
}
