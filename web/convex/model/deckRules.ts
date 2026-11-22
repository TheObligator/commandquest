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
  /** The player's own categories for this card ("Ramp", "Win condition", …), for grouping the deck. */
  tags?: string[];
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
  const bracket = input.bracket ?? undefined;
  if (bracket !== undefined && !(Number.isInteger(bracket) && bracket >= 1 && bracket <= 5)) throw new DeckError("Brackets are 1 to 5.");
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
      return out;
    }),
  };
}

export interface DeckSummary {
  cardCount: number;
  commanders: string[];
  coverScryfallId?: string;
}

/** What the deck list shows: main deck + commander count, commander names, cover art id. */
/** The player's bracket tags tidied: trimmed, no blanks or repeats (ignoring case), capped in length and number. */
export function cleanBracketTags(tags: string[]): string[] {
  return cleanTags(tags, MAX_BRACKET_TAG_LENGTH, MAX_BRACKET_TAGS);
}

/** A card's tags tidied: trimmed, no blanks or repeats (ignoring case), capped in length and number. */
export function cleanCardTags(tags: string[]): string[] {
  return cleanTags(tags, MAX_CARD_TAG_LENGTH, MAX_CARD_TAGS);
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

export function summarize(cards: DeckCard[]): DeckSummary {
  const cardCount = cards.filter((c) => c.board === "main" || c.board === "commander").reduce((n, c) => n + c.quantity, 0);
  const cmdrs = cards.filter((c) => c.board === "commander");
  return { cardCount, commanders: cmdrs.map((c) => c.name), coverScryfallId: cmdrs.find((c) => c.scryfallId)?.scryfallId };
}
