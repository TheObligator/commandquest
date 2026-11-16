// Rulebreaker commanders: commanders whose own text changes how their deck is built ("A deck with
// this commander has no maximum deck size", "...can have Aura cards of any color identity").
// The rules engine already knows them (the DeckRule lines in Forge's card scripts); this mirrors
// those lines for the deck editor's checks and card search, using Scryfall card data. When Forge
// adds a new one (grep cardsfolder for "^DeckRule"), add it here too.
//
// Pure logic with no DOM or browser APIs, so `node --test` can run it.

import type { RulesCard } from "./conquest";

const normalizeName = (name: string) => name.replace(/[‘’]/g, "'").trim().toLowerCase();

type Card = RulesCard & { power?: string; cmc?: number; card_faces?: { type_line?: string; power?: string }[] };

/** What a Rulebreaker commander changes about its deck. */
export interface DeckRule {
  /** The deck has no maximum size (the minimum still applies). */
  noMaxSize?: boolean;
  /** Cards that may be any color identity, as a test and as a Scryfall query. */
  anyIdentity?: { test: (c: Card) => boolean; scry: string };
  /** Cards whose color identity may also include one color the player picks for the deck. */
  oneExtraColor?: { test: (c: Card) => boolean; scry: string; label: string };
}

/** The type line of the face a card has in a library (the front face). */
const front = (c: Card) => c.card_faces?.[0]?.type_line ?? c.type_line.split(" // ")[0];
const is = (re: RegExp) => (c: Card) => re.test(front(c));
const either = (...ps: ((c: Card) => boolean)[]) => (c: Card) => ps.some((p) => p(c));
const both = (...ps: ((c: Card) => boolean)[]) => (c: Card) => ps.every((p) => p(c));

const basicLand = both(is(/\bBasic\b/), is(/\bLand\b/));
const BASIC = "(t:basic t:land)";
/** Printed power; "*" counts as 0, as it does outside the battlefield. */
const power = (c: Card) => parseInt(c.card_faces?.[0]?.power ?? c.power ?? "", 10) || 0;

const RULES: Record<string, DeckRule> = {
  "Whtz, the Bibliophile": { noMaxSize: true },
  "The Covert Blue Mage": { noMaxSize: true },
  "Grizzlegom, Hurloon Hero": { anyIdentity: { test: is(/\bLand\b/), scry: "t:land" } },
  "The Everforger": {
    anyIdentity: { test: either(both(is(/\bArtifact\b/), is(/\bCreature\b/)), is(/\bEquipment\b/), basicLand), scry: `(t:artifact t:creature) or t:equipment or ${BASIC}` },
  },
  "Tolabow, Loch Rascal": {
    anyIdentity: { test: basicLand, scry: BASIC },
    oneExtraColor: { test: is(/\b(Instant|Sorcery)\b/), scry: "(t:instant or t:sorcery)", label: "instants and sorceries" },
  },
  "The Unluckiest Planeswalker": { anyIdentity: { test: either(is(/\bAura\b/), basicLand), scry: `t:aura or ${BASIC}` } },
  "Seluma, Light of Aysen": { anyIdentity: { test: either(is(/\bAngel\b/), basicLand), scry: `t:angel or ${BASIC}` } },
  "Arvad of the Weatherlight": {
    anyIdentity: { test: both(is(/\bLegendary\b/), is(/\b(Artifact|Creature|Enchantment|Land|Planeswalker|Battle)\b/)), scry: "(t:legendary is:permanent)" },
  },
  "Hadran, Naya Sunseeder": { anyIdentity: { test: both(is(/\bCreature\b/), (c) => power(c) >= 4), scry: "(t:creature pow>=4)" } },
  "Maular, the Next Evolution": {
    anyIdentity: { test: either(both(is(/\bCreature\b/), (c) => (c.cmc ?? 0) >= 7), basicLand), scry: `(t:creature mv>=7) or ${BASIC}` },
  },
  "Daxiver, Izzet Electromancer": { anyIdentity: { test: is(/\b(Instant|Sorcery)\b/), scry: "t:instant or t:sorcery" } },
  "Valko Indorian": { anyIdentity: { test: either(is(/\bPhyrexian\b/), basicLand), scry: `t:phyrexian or ${BASIC}` } },
  "Valko Indorian, Researcher": { anyIdentity: { test: is(/\b(Artifact|Enchantment)\b/), scry: "t:artifact or t:enchantment" } },
};
const BY_NAME = new Map(Object.entries(RULES).map(([n, r]) => [normalizeName(n), r]));

/** The Rulebreaker rule of one commander, if it has one. */
export function rulebreaker(commander: { name: string }): DeckRule | undefined {
  return BY_NAME.get(normalizeName(commander.name)) ?? BY_NAME.get(normalizeName(commander.name.split(" // ")[0]));
}

const rulesOf = (commanders: { name: string }[]) => commanders.flatMap((c) => rulebreaker(c) ?? []);

/** Does any of these commanders lift the maximum deck size? */
export function noMaxDeckSize(commanders: { name: string }[]): boolean {
  return rulesOf(commanders).some((r) => r.noMaxSize);
}

/** If a commander lets the player pick an extra color, what that color is for ("instants and sorceries"). */
export function extraColorChoice(commanders: { name: string }[]): string | undefined {
  return rulesOf(commanders).find((r) => r.oneExtraColor)?.oneExtraColor!.label;
}

const COLORS = "WUBRG";

type Fits = (card: RulesCard, identity: Set<string>) => boolean;

/** Cards outside the identity that no "any color identity" rule lets in. */
function plainlyOff<E extends { card: RulesCard }>(entries: E[], commanders: RulesCard[], fits: Fits): { identity: Set<string>; off: E[] } {
  const identity = new Set(commanders.flatMap((c) => c.color_identity));
  const rules = rulesOf(commanders);
  return { identity, off: entries.filter((e) => !fits(e.card, identity) && !rules.some((r) => r.anyIdentity?.test(e.card))) };
}

/** The off-color cards that adding `color` to the identity lets in, under an extra-color rule. */
function fixedBy<E extends { card: RulesCard; quantity?: number }>(off: E[], commanders: RulesCard[], identity: Set<string>, fits: Fits, color: string): E[] {
  const extra = rulesOf(commanders).flatMap((r) => r.oneExtraColor ?? []);
  const wider = new Set([...identity, color]);
  return off.filter((e) => extra.some((r) => r.test(e.card)) && fits(e.card, wider));
}

/**
 * For a commander like Tolabow: the extra color that lets in the most of the deck's cards, or
 * undefined when no color lets any in (or the commanders have no such rule).
 */
export function bestExtraColor<E extends { card: RulesCard; quantity?: number }>(entries: E[], commanders: RulesCard[], fits: Fits): string | undefined {
  if (!extraColorChoice(commanders)) return undefined;
  const { identity, off } = plainlyOff(entries, commanders, fits);
  let best: string | undefined;
  let most = 0;
  for (const color of COLORS) {
    if (identity.has(color)) continue;
    const n = fixedBy(off, commanders, identity, fits, color).reduce((sum, e) => sum + (e.quantity ?? 1), 0);
    if (n > most) (best = color), (most = n);
  }
  return best;
}

/**
 * The main-deck cards outside the commanders' color identity, after their Rulebreaker rules.
 * `fits` is the format's own identity test (Conquest relaxes hybrid symbols). `extraColor` is the
 * deck's pick for a commander like Tolabow; without one, the color that fits the most cards counts.
 */
export function offIdentity<E extends { name: string; card: RulesCard; quantity?: number }>(
  entries: E[],
  commanders: RulesCard[],
  fits: Fits,
  extraColor?: string,
): E[] {
  const { identity, off } = plainlyOff(entries, commanders, fits);
  if (!extraColorChoice(commanders)) return off;
  const color = extraColor && COLORS.includes(extraColor) && !identity.has(extraColor) ? extraColor : bestExtraColor(entries, commanders, fits);
  if (!color) return off;
  const fixed = new Set(fixedBy(off, commanders, identity, fits, color));
  return off.filter((e) => !fixed.has(e));
}

/**
 * A Scryfall query clause for the cards this deck can use: the commanders' color identity, plus
 * whatever their Rulebreaker rules allow. Conquest's hybrid relaxation has no Scryfall syntax,
 * so `hybrid` lets hybrid cards through too (the caller checks those itself).
 */
export function identityQuery(commanders: RulesCard[], extraColor?: string, hybrid = false): string {
  const identity = COLORS.split("").filter((c) => commanders.some((cm) => cm.color_identity.includes(c)));
  const id = (colors: string[]) => (colors.length ? `id<=${colors.join("").toLowerCase()}` : "id:c");
  const parts = [id(identity)];
  if (hybrid) parts.push("is:hybrid");
  for (const r of rulesOf(commanders)) {
    if (r.anyIdentity) parts.push(`(${r.anyIdentity.scry})`);
    if (r.oneExtraColor && extraColor && COLORS.includes(extraColor) && !identity.includes(extraColor)) {
      parts.push(`(${r.oneExtraColor.scry} ${id([...identity, extraColor])})`);
    }
  }
  return parts.length === 1 ? parts[0] : `(${parts.join(" or ")})`;
}

/** Does the query already say something about color identity? Then the user's filter wins. */
export function mentionsIdentity(query: string): boolean {
  return /(^|[\s(-])(id|ci|identity|commander|cmd)[:<>=!]/i.test(query);
}
