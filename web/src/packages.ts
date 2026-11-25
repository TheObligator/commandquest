// What adding a package to a deck would do: which of its cards fit the deck, which it already has,
// and which are outside its commander's colors (Rulebreakers and Conquest's hybrid rule included)
// or not legal in its format. No DOM or React, so `node --test` can run it.
import type { Board, DeckCard } from "../convex/model/deckRules.ts";
import { plainFits } from "./cardsearch.ts";
import { CARD_LIST, hasCommander } from "./deckFormats.ts";
import { cardLegality, fitsIdentity, maxCopies, type RulesCard } from "./formats/conquest.ts";
import { bestExtraColor, offIdentity } from "./formats/rulebreakers.ts";

/** `unknown`: Scryfall doesn't know the card. */
export type PackageFit = "fits" | "have" | "off" | "illegal" | "unknown";

export interface PackageEntry {
  card: DeckCard;
  fit: PackageFit;
  /** Copies to add: the deck is brought up to the package's number (one, in a singleton format). */
  copies: number;
}

export interface DeckFor {
  format: string;
  cards: DeckCard[];
  /** The color a Rulebreaker commander like Tolabow lets this deck add. */
  extraColor?: string;
}

type CardOf = (c: DeckCard) => RulesCard | undefined;

/** A card name compared without case or its back face. */
export const cardKey = (name: string) => name.split(" // ")[0].replace(/[‘’]/g, "'").trim().toLowerCase();

/** The package's cards, each with how it fits the deck, in the package's order. */
export function planPackage(cards: DeckCard[], deck: DeckFor, cardOf: CardOf, board: Board = "main"): PackageEntry[] {
  const led = hasCommander(deck.format);
  const conquest = deck.format === "conquest";
  const commanders = led ? deck.cards.filter((c) => c.board === "commander").flatMap((c) => cardOf(c) ?? []) : [];
  const fits = conquest ? fitsIdentity : plainFits;

  // Cards being considered aren't in the deck yet, unless that's where these are going.
  const have = new Map<string, number>();
  for (const c of deck.cards) if (c.board !== "maybe" || board === "maybe") have.set(cardKey(c.name), (have.get(cardKey(c.name)) ?? 0) + c.quantity);

  const known = cards.flatMap((c) => {
    const card = cardOf(c);
    return card ? [{ name: cardKey(c.name), card, quantity: c.quantity }] : [];
  });
  // An extra color (Tolabow) follows the deck's own cards first; the package only decides for a deck with none.
  const main = deck.cards.flatMap((c) => {
    const card = c.board === "main" ? cardOf(c) : undefined;
    return card ? [{ card, quantity: c.quantity }] : [];
  });
  const extraColor = deck.extraColor ?? bestExtraColor(main, commanders, fits);
  const off = new Set(commanders.length ? offIdentity(known, commanders, fits, extraColor).map((e) => e.name) : []);

  return cards.map((c) => {
    const card = cardOf(c);
    const held = have.get(cardKey(c.name)) ?? 0;
    const wanted = led && card ? Math.min(c.quantity, maxCopies(card)) : c.quantity;
    const copies = Math.max(0, wanted - held);
    const fit: PackageFit = !copies ? "have" : !card ? "unknown" : off.has(cardKey(c.name)) ? "off" : !legal(card, deck.format) ? "illegal" : "fits";
    return { card: c, fit, copies };
  });
}

function legal(card: RulesCard, format: string): boolean {
  if (format === "other" || format === CARD_LIST) return true;
  if (format === "conquest") return cardLegality(card).ok;
  const l = card.legalities?.[format];
  return l !== "banned" && l !== "not_legal";
}

export const copiesIn = (entries: { copies: number }[]) => entries.reduce((n, e) => n + e.copies, 0);

/** The colors of the package's cards, in WUBRG order. */
export const packageColors = (cards: DeckCard[], cardOf: CardOf): string[] => {
  const all = new Set(cards.flatMap((c) => cardOf(c)?.color_identity ?? []));
  return [..."WUBRG"].filter((x) => all.has(x));
};
