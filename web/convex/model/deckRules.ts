// Deck validation shared by the Convex functions. Pure (no Convex imports), so `node --test`
// can run it. Ported from the old Java server's DeckInput.

export type Board = "commander" | "main" | "side" | "maybe";
export const BOARDS: readonly Board[] = ["commander", "main", "side", "maybe"];

export interface DeckCard {
  name: string;
  quantity: number;
  board: Board;
  scryfallId?: string;
  set?: string;
  collectorNumber?: string;
  /** The player's own labels for this card ("Test", "Win condition", …), for grouping the deck. */
  tags?: string[];
  /** The category the player (or an imported deck) puts this card in; absent = the automatic one (src/cardCategories.ts). */
  category?: string;
}

export interface DeckInput {
  name: string;
  format?: string;
  cards: DeckCard[];
  /** The color a Rulebreaker commander like Tolabow lets this deck add (web/src/formats/rulebreakers.ts). */
  extraColor?: string;
  /** The Commander bracket (1-5) the player says this deck is (web/src/brackets.ts). */
  bracket?: number;
  /** The player's reasons for that bracket ("Two-card combo", "Fast mana", …). */
  bracketTags?: string[];
}

export const MAX_NAME = 100;
export const MAX_CARDS = 1000;
export const MAX_QUANTITY = 250;
/** The most cards a deck can have in a game (forge-web-server's Decks.MAX_DECK_SIZE). */
export const MAX_DECK_SIZE = 1000;
export const MAX_DECKS_PER_USER = 500;
export const MAX_BRACKET_TAGS = 20;
export const MAX_BRACKET_TAG_LENGTH = 40;
export const MAX_CARD_TAGS = 10;
export const MAX_CARD_TAG_LENGTH = 30;

const FORMAT = /^[a-z0-9_-]{1,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class DeckError extends Error {}

const clip = (s: string | undefined, max: number) => {
  const t = s?.trim();
  return t ? t.slice(0, max) : undefined;
};

/** Checks and normalizes a deck. Throws DeckError with a user-facing message. */
export function validateDeck(input: DeckInput): Required<Pick<DeckInput, "name" | "format">> & {
  cards: DeckCard[];
  extraColor: string | undefined;
  bracket: number | undefined;
  bracketTags: string[] | undefined;
} {
  const name = (input.name ?? "").trim();
  if (!name || name.length > MAX_NAME) throw new DeckError(`Deck names are 1-${MAX_NAME} characters.`);
  const format = (input.format ?? "").trim().toLowerCase() || "commander";
  if (!FORMAT.test(format)) throw new DeckError("Unknown format.");
  const cards = input.cards ?? [];
  if (cards.length > MAX_CARDS) throw new DeckError(`A deck can have at most ${MAX_CARDS} different entries.`);
  const extraColor = input.extraColor || undefined;
  if (extraColor !== undefined && !/^[WUBRG]$/.test(extraColor)) throw new DeckError("Unknown color.");
  const bracket = checkBracket(input.bracket);
  if ((input.bracketTags?.length ?? 0) > MAX_BRACKET_TAGS * 2) throw new DeckError(`A deck can have at most ${MAX_BRACKET_TAGS} bracket tags.`);
  const bracketTags = cleanBracketTags(input.bracketTags ?? []);
  return {
    name,
    format,
    // Always present, so an update that drops the pick clears it (a patch with undefined removes a field).
    extraColor,
    bracket,
    bracketTags: bracketTags.length ? bracketTags : undefined,
    cards: cards.map((c) => {
      const cardName = (c.name ?? "").trim();
      if (!cardName || cardName.length > 200) throw new DeckError("Every card needs a name.");
      if (!Number.isInteger(c.quantity) || c.quantity < 1 || c.quantity > MAX_QUANTITY) {
        throw new DeckError(`Bad quantity for ${cardName}.`);
      }
      const board = c.board ?? "main";
      if (!BOARDS.includes(board)) throw new DeckError(`Unknown board "${board}".`);
      if (c.scryfallId !== undefined && !UUID.test(c.scryfallId)) throw new DeckError(`Bad Scryfall id for ${cardName}.`);
      const out: DeckCard = { name: cardName, quantity: c.quantity, board };
      if (c.scryfallId) out.scryfallId = c.scryfallId;
      const set = clip(c.set, 10);
      if (set) out.set = set;
      const cn = clip(c.collectorNumber, 16);
      if (cn) out.collectorNumber = cn;
      if ((c.tags?.length ?? 0) > MAX_CARD_TAGS * 2) throw new DeckError(`A card can have at most ${MAX_CARD_TAGS} tags.`);
      const tags = cleanCardTags(c.tags ?? []);
      if (tags.length) out.tags = tags;
      const category = cleanCategory(c.category);
      if (category) out.category = category;
      return out;
    }),
  };
}

/** A card by name and printing, to look up. */
export type CardRef = Pick<DeckCard, "name" | "scryfallId" | "set" | "collectorNumber">;

export interface DeckSummary {
  cardCount: number;
  commanders: string[];
  coverScryfallId?: string;
}

/** The bracket, or undefined when there's none. Throws DeckError when it isn't one. */
export function checkBracket(bracket: number | null | undefined): number | undefined {
  if (bracket === undefined || bracket === null) return undefined;
  if (!(Number.isInteger(bracket) && bracket >= 1 && bracket <= 5)) throw new DeckError("Brackets are 1 to 5.");
  return bracket;
}

/** The cards that give a deck its colors in the deck list: its commanders, or without any, the main deck. */
export function colorCards(cards: DeckCard[]): CardRef[] {
  const cmdrs = cards.filter((c) => c.board === "commander");
  return (cmdrs.length ? cmdrs : cards.filter((c) => c.board === "main")).map(({ name, scryfallId, set, collectorNumber }) => ({ name, scryfallId, set, collectorNumber }));
}

/** The player's bracket tags tidied: trimmed, no blanks or repeats (ignoring case), capped in length and number. */
export function cleanBracketTags(tags: string[]): string[] {
  return cleanTags(tags, MAX_BRACKET_TAG_LENGTH, MAX_BRACKET_TAGS);
}

/** A card's tags tidied: trimmed, no blanks or repeats (ignoring case), capped in length and number. */
export function cleanCardTags(tags: string[]): string[] {
  return cleanTags(tags, MAX_CARD_TAG_LENGTH, MAX_CARD_TAGS);
}

/** A card's category tidied like a tag, or undefined when there's nothing left of it. */
export function cleanCategory(category: string | undefined): string | undefined {
  return category === undefined ? undefined : cleanCardTags([category])[0];
}

function cleanTags(tags: string[], maxLength: number, maxCount: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const tag = String(t).trim().replace(/\s+/g, " ").slice(0, maxLength).trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out.slice(0, maxCount);
}

/**
 * What the deck list shows: main deck + commander count, commander names, cover art id.
 * `anyCover`: without a commander, the first card with a printing is the cover (card lists).
 */
export function summarize(cards: DeckCard[], anyCover = false): DeckSummary {
  const cardCount = cards.filter((c) => c.board === "main" || c.board === "commander").reduce((n, c) => n + c.quantity, 0);
  const cmdrs = cards.filter((c) => c.board === "commander");
  return { cardCount, commanders: cmdrs.map((c) => c.name), coverScryfallId: (cmdrs.find((c) => c.scryfallId) ?? (anyCover ? cards.find((c) => c.scryfallId) : undefined))?.scryfallId };
}

/**
 * `cards` with `added` put in (from another deck: "Add to another deck…"). A card already on that
 * board gets the extra copies (up to MAX_QUANTITY) and keeps its own printing; a new one comes in
 * with the printing, tags and category it had. `oneBoard`: a plain card list, where everything goes
 * in the main deck.
 */
export function withCardsAdded(cards: DeckCard[], added: DeckCard[], oneBoard = false): DeckCard[] {
  const out = cards.map((c) => ({ ...c }));
  for (const a of added) {
    const board: Board = oneBoard ? "main" : a.board;
    const same = out.find((c) => c.board === board && c.name.toLowerCase() === a.name.toLowerCase());
    if (same) same.quantity = Math.min(MAX_QUANTITY, same.quantity + a.quantity);
    else out.push({ ...a, board, quantity: Math.min(MAX_QUANTITY, a.quantity) });
  }
  return out;
}
