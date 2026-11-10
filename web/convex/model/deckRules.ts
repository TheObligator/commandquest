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
}

export interface DeckInput {
  name: string;
  format?: string;
  cards: DeckCard[];
}

export const MAX_NAME = 100;
export const MAX_CARDS = 1000;
export const MAX_QUANTITY = 250;
export const MAX_DECKS_PER_USER = 500;

const FORMAT = /^[a-z0-9_-]{1,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class DeckError extends Error {}

const clip = (s: string | undefined, max: number) => {
  const t = s?.trim();
  return t ? t.slice(0, max) : undefined;
};

/** Checks and normalizes a deck. Throws DeckError with a user-facing message. */
export function validateDeck(input: DeckInput): Required<Pick<DeckInput, "name" | "format">> & { cards: DeckCard[] } {
  const name = (input.name ?? "").trim();
  if (!name || name.length > MAX_NAME) throw new DeckError(`Deck names are 1-${MAX_NAME} characters.`);
  const format = (input.format ?? "").trim().toLowerCase() || "commander";
  if (!FORMAT.test(format)) throw new DeckError("Unknown format.");
  const cards = input.cards ?? [];
  if (cards.length > MAX_CARDS) throw new DeckError(`A deck can have at most ${MAX_CARDS} different entries.`);
  return {
    name,
    format,
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
export function summarize(cards: DeckCard[]): DeckSummary {
  const cardCount = cards.filter((c) => c.board === "main" || c.board === "commander").reduce((n, c) => n + c.quantity, 0);
  const cmdrs = cards.filter((c) => c.board === "commander");
  return { cardCount, commanders: cmdrs.map((c) => c.name), coverScryfallId: cmdrs.find((c) => c.scryfallId)?.scryfallId };
}
