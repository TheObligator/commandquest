// Package rules shared by the Convex functions (convex/packages.ts). Pure, so `node --test` can run it.
import { DeckError, MAX_QUANTITY, validateDeck, type DeckCard } from "./deckRules.ts";

export const MAX_PACKAGES_PER_USER = 100;
export const MAX_PACKAGE_CARDS = 300;
export const MAX_PACKAGE_NAME = 60;
export const MAX_PACKAGE_NOTE = 120;

export interface PackageInput {
  name: string;
  note?: string;
  cards: DeckCard[];
}

/** Checks and normalizes a package. It's one list: every card is on the main board. */
export function validatePackage(input: PackageInput): { name: string; note: string | undefined; cards: DeckCard[] } {
  const name = (input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > MAX_PACKAGE_NAME) throw new DeckError(`Package names are 1-${MAX_PACKAGE_NAME} characters.`);
  const note = (input.note ?? "").trim().slice(0, MAX_PACKAGE_NOTE).trim();
  if (input.cards.length > MAX_PACKAGE_CARDS) throw new DeckError(`A package can have at most ${MAX_PACKAGE_CARDS} different cards.`);
  const { cards } = validateDeck({ name, cards: input.cards.map((c) => ({ ...c, board: "main" as const })) });
  return { name, note: note || undefined, cards };
}

const key = (name: string) => name.split(" // ")[0].trim().toLowerCase();

export const inPackage = (cards: DeckCard[], name: string) => cards.some((c) => key(c.name) === key(name));

/** The package's cards with `card` added, or one copy more of it if it's there already. */
export function withCard(cards: DeckCard[], card: DeckCard): DeckCard[] {
  if (inPackage(cards, card.name)) return cards.map((c) => (key(c.name) === key(card.name) ? { ...c, quantity: Math.min(MAX_QUANTITY, c.quantity + card.quantity) } : c));
  return [...cards, { ...card, board: "main" }];
}
