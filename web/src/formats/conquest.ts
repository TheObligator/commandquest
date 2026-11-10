// Conquest: a Commander variant. Ruleset (as of 2026-11-08):
// https://docs.google.com/document/d/1LOh-zWLvt2CLSsSIsBCEURVNmyKGyznINwvJsXZymy4
// Summarised in docs/formats/conquest.md, which also lists the in-game rules.
//
// Deck-construction rules checked here:
//  1. Commander: a legendary Creature, Planeswalker, Vehicle or Spacecraft card, or a double-faced /
//     flip card whose back face is one. Partner-style pairs follow base Commander rules.
//  4. At least 80 cards, singleton except basic lands.
//  6. Hybrid symbols may count as any one of their halves for color identity, and the card's own
//     colors are ignored.
//  Card pool: every tournament-legal card except the Reserved List and the Conquest ban list.
//
// Pure logic with no DOM or browser APIs, so `node --test` can run it.

import type { ScryCard } from "../scryfall";

export const CONQUEST = {
  id: "conquest",
  name: "Conquest",
  minDeckSize: 80,
  startingLife: 30,
  startingLifeTwoPlayer: 25,
  commanderDamage: 12,
  rulesUrl: "https://docs.google.com/document/d/1LOh-zWLvt2CLSsSIsBCEURVNmyKGyznINwvJsXZymy4/edit",
} as const;

/** Card names are compared with straight apostrophes and in lower case. */
export function normalizeName(name: string): string {
  return name.replace(/[‘’]/g, "'").trim().toLowerCase();
}

const set = (names: string[]) => new Set(names.map(normalizeName));

export const BANNED = set([
  "Ancient Tomb", "Balance", "Carpet of Flowers", "Channel", "Chrome Mox", "Cyclonic Rift",
  "Demonic Consultation", "Demonic Tutor", "Dockside Extortionist", "Drannith Magistrate",
  "Erayo, Soratami Ascendant", "Finale of Devastation", "Flash", "Gemstone Caverns", "Hullbreacher",
  "Jeweled Lotus", "Karakas", "Mana Crypt", "Mana Drain", "Mana Vault", "Mystic Remora",
  "Mystical Tutor", "Nadu, Winged Wisdom", "Natural Order", "Rhystic Study", "Sol Ring",
  "Sylvan Library", "Tainted Pact", "The One Ring", "Tinker", "Trade Secrets", "Underworld Breach",
  "Upheaval", "Vampiric Tutor", "Worldly Tutor",
  // The 10 Zendikar + Onslaught fetchlands
  "Arid Mesa", "Bloodstained Mire", "Flooded Strand", "Marsh Flats", "Misty Rainforest",
  "Polluted Delta", "Scalding Tarn", "Verdant Catacombs", "Windswept Heath", "Wooded Foothills",
]);

export const BANNED_AS_COMMANDER = set([
  "Inalla, Archmage Ritualist", "Kinnan, Bonder Prodigy", "Oko, Thief of Crowns", "Ral, Monsoon Mage",
  "Rograkh, Son of Rohgahh", "Thrasios, Triton Hero", "Tymna the Weaver", "Yuriko, the Tiger's Shadow",
]);

export const BANNED_AS_COMPANION = set(["Lutri, the Spellchaser"]);

/** The fields of a Scryfall card these rules need. */
export type RulesCard = Pick<ScryCard, "name" | "layout" | "type_line" | "mana_cost" | "oracle_text" | "color_identity" | "legalities" | "keywords"> & {
  reserved?: boolean;
  color_indicator?: string[];
  card_faces?: { name: string; type_line?: string; mana_cost?: string; oracle_text?: string; color_indicator?: string[] }[];
};

export interface Verdict {
  ok: boolean;
  reason?: string;
}

/**
 * Card pool legality. Conquest allows every regulation-sized, black/white-bordered paper card
 * except the Reserved List. Scryfall's Vintage legality already encodes the rest of that:
 *  - "not_legal" in Vintage: silver-bordered, acorn-stamped, digital-only and oversized cards
 *  - "banned" in Vintage: Conspiracies, ante, stickers/attractions, and cards Wizards removed
 * Vintage *restricted* cards are fine in Conquest unless they're on its own ban list.
 */
export function cardLegality(card: RulesCard): Verdict {
  const name = normalizeName(card.name);
  const front = card.card_faces?.[0]?.name;
  if (BANNED.has(name) || (front && BANNED.has(normalizeName(front)))) return { ok: false, reason: "banned in Conquest" };
  if (card.reserved) return { ok: false, reason: "on the Reserved List" };
  const vintage = card.legalities?.vintage;
  if (vintage === "banned" || /\bConspiracy\b/.test(card.type_line)) {
    return { ok: false, reason: "banned (Conspiracy, ante, sticker/attraction, or removed by Wizards)" };
  }
  if (vintage !== "legal" && vintage !== "restricted") {
    return { ok: false, reason: "not a tournament-legal card (silver border, acorn stamp, digital-only or oversized)" };
  }
  return { ok: true };
}

const COMMANDER_TYPES = /\b(Creature|Planeswalker|Vehicle|Spacecraft)\b/;
const isLegendaryCommanderType = (typeLine: string | undefined) =>
  !!typeLine && /\bLegendary\b/.test(typeLine) && COMMANDER_TYPES.test(typeLine);
const BACK_FACE_LAYOUTS = ["transform", "modal_dfc", "flip"];

/** Rule 1: can this card be a commander? (Ignores the ban list; see `commanderLegality`.) */
export function isCommanderEligible(card: RulesCard): boolean {
  const front = card.card_faces?.[0]?.type_line ?? card.type_line.split(" // ")[0];
  if (isLegendaryCommanderType(front)) return true;
  if (BACK_FACE_LAYOUTS.includes(card.layout)) {
    const back = card.card_faces?.[1]?.type_line ?? card.type_line.split(" // ")[1];
    if (isLegendaryCommanderType(back)) return true;
  }
  return false;
}

const isBackground = (c: RulesCard) => /\bBackground\b/.test(c.type_line);
const hasKeyword = (c: RulesCard, re: RegExp) => (c.keywords ?? []).some((k) => re.test(k)) || re.test(c.oracle_text ?? "");
const PARTNER = /\b(Partner|Friends forever|Doctor's companion)\b/i;
const CHOOSE_BACKGROUND = /\bChoose a Background\b/i;

/** Commander legality for one or two commanders, including base Commander's pairing rules. */
export function commanderProblems(cmdrs: RulesCard[]): string[] {
  const out: string[] = [];
  if (cmdrs.length === 0) return ["No commander yet. Use ★ on a search result or move a card to the Commander board."];
  if (cmdrs.length > 2) return ["A deck can have at most two commanders (a partner pair or a commander with a Background)."];
  const pairWithBackground =
    cmdrs.length === 2 && cmdrs.some(isBackground) && cmdrs.some((c) => !isBackground(c) && hasKeyword(c, CHOOSE_BACKGROUND));
  for (const c of cmdrs) {
    if (BANNED_AS_COMMANDER.has(normalizeName(c.name))) out.push(`${c.name} is banned as a commander in Conquest.`);
    else if (!isCommanderEligible(c) && !(pairWithBackground && isBackground(c))) {
      out.push(`${c.name} can't be a commander in Conquest (it must be a legendary creature, planeswalker, vehicle or spacecraft).`);
    }
  }
  if (cmdrs.length === 2 && !pairWithBackground && !cmdrs.every((c) => hasKeyword(c, PARTNER))) {
    out.push("Two commanders are only allowed if both have partner (or one chooses a Background).");
  }
  return out;
}

const COLORS = ["W", "U", "B", "R", "G"];

/**
 * Rule 6: does this card fit the commander's color identity, treating each hybrid symbol as any
 * one of its halves?
 *
 * We start from Scryfall's color identity, which already covers everything in CR 903.4 (mana
 * symbols in cost and rules text, color indicators, and characteristic-defining abilities like
 * "Transguild Courier is all colors"). The only colors relaxed are those that come purely from
 * hybrid symbols. A hybrid symbol with a generic or colorless half ({2/W}, {C/W}) can be paid
 * without color, so it adds no requirement. Reminder text is ignored, as in CR 903.4.
 */
export function fitsIdentity(card: RulesCard, identity: Set<string>): boolean {
  const faces = card.card_faces?.length ? card.card_faces : [card];
  const fixed = new Set<string>(card.color_indicator ?? []);
  const hybridColors = new Set<string>();
  const choices: string[][] = [];
  for (const f of faces) {
    for (const c of f.color_indicator ?? []) fixed.add(c);
    const text = `${f.mana_cost ?? ""} ${(f.oracle_text ?? "").replace(/\([^)]*\)/g, "")}`;
    for (const m of text.matchAll(/\{([^}]+)\}/g)) {
      const parts = m[1].split("/").filter((p) => p !== "P");
      const colors = parts.filter((p) => COLORS.includes(p));
      colors.forEach((c) => hybridColors.add(c));
      if (!colors.length) continue;
      if (parts.length === 1) fixed.add(colors[0]);
      else if (colors.length === parts.length) choices.push(colors);
      // else: a hybrid with a generic/colorless half adds nothing
    }
  }
  // Colors that appear in no mana symbol (e.g. from a characteristic-defining ability) stay required.
  const required = card.color_identity.filter((c) => fixed.has(c) || !hybridColors.has(c));
  if (required.some((c) => !identity.has(c))) return false;
  return choices.every((opts) => opts.some((c) => identity.has(c)));
}

const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/**
 * How many copies a deck may hold. Conquest is singleton except basic lands. Cards whose own text
 * allows more ("any number of cards named…", "up to seven cards named…") override the deck rule,
 * as card text does in base Commander.
 */
export function maxCopies(card: RulesCard): number {
  if (/\bBasic\b/.test(card.type_line) && /\bLand\b/.test(card.type_line)) return Infinity;
  const text = card.oracle_text ?? card.card_faces?.map((f) => f.oracle_text).join("\n") ?? "";
  if (/any number of cards named/i.test(text)) return Infinity;
  const m = /up to (\w+) cards named/i.exec(text);
  if (m) return NUMBER_WORDS[m[1].toLowerCase()] ?? (Number(m[1]) || 1);
  return 1;
}

export interface DeckEntry {
  name: string;
  quantity: number;
  board: "commander" | "main" | "side" | "maybe";
  card?: RulesCard;
}

/** Every Conquest deck-construction problem, as user-facing sentences. */
export function validateConquest(entries: DeckEntry[]): string[] {
  const out: string[] = [];
  const list = (names: string[]) => names.slice(0, 6).join(", ") + (names.length > 6 ? "…" : "");

  const cmdrEntries = entries.filter((e) => e.board === "commander");
  const cmdrs = cmdrEntries.flatMap((e) => (e.card ? Array(e.quantity).fill(e.card) : []));
  if (cmdrEntries.every((e) => e.card)) out.push(...commanderProblems(cmdrs));

  const inDeck = entries.filter((e) => e.board === "main" || e.board === "commander");
  const total = inDeck.reduce((n, e) => n + e.quantity, 0);
  if (total < CONQUEST.minDeckSize) out.push(`Conquest decks have at least ${CONQUEST.minDeckSize} cards, commander included (you have ${total}).`);

  // Singleton across main deck + commander, by card name.
  const copies = new Map<string, { n: number; card?: RulesCard; name: string }>();
  for (const e of inDeck) {
    const key = normalizeName(e.name);
    const prev = copies.get(key) ?? { n: 0, card: e.card, name: e.name };
    prev.n += e.quantity;
    copies.set(key, prev);
  }
  const dupes = [...copies.values()].filter((c) => c.card && c.n > maxCopies(c.card)).map((c) => c.name);
  if (dupes.length) out.push(`Conquest is singleton (basic lands excepted), but you have multiples of: ${list(dupes)}.`);

  // Card pool + ban list (main, commander, and sideboard, which holds companions).
  const illegal = new Map<string, string[]>();
  for (const e of entries) {
    if (e.board === "maybe" || !e.card) continue;
    const v = cardLegality(e.card);
    if (!v.ok) illegal.set(v.reason!, [...(illegal.get(v.reason!) ?? []), e.name]);
  }
  for (const [reason, names] of illegal) out.push(`Not legal in Conquest, ${reason}: ${list(names)}.`);

  const badCompanions = entries.filter((e) => e.board === "side" && BANNED_AS_COMPANION.has(normalizeName(e.name))).map((e) => e.name);
  if (badCompanions.length) out.push(`Banned as a companion in Conquest: ${list(badCompanions)}.`);

  // Color identity with the hybrid rule. Commanders use their full (Scryfall) color identity.
  if (cmdrs.length) {
    const identity = new Set(cmdrs.flatMap((c) => c.color_identity));
    const off = entries.filter((e) => e.board === "main" && e.card && !fitsIdentity(e.card, identity)).map((e) => e.name);
    if (off.length) out.push(`Outside your commander's colors: ${list(off)}.`);
  }
  return out;
}
