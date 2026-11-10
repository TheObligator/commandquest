// A deck's tokens, like Moxfield's token list: every token the deck's cards make (from Scryfall's
// `all_parts`), one entry per kind of token, each with a default printing and your choice.
//
// Default printing: the commander's version if a commander makes that token, else the version made
// by the newest card in the deck that makes it. Your choices are stored per deck (Convex
// `decks.tokenArt`) and win over the default. In games, each of your tokens uses the art of its kind
// (`tokenIdentity`), matched on the game server.
//
// No React or DOM here, so `npm test` covers it.
import type { DeckCard } from "../convex/model/deckRules";
import type { ScryCard } from "./scryfall";

/** What makes two tokens "the same token": name, colors, P/T. "Goblin|R|1/1", "Treasure||-". */
export function tokenIdentity(t: { name: string; colors?: string[]; power?: string; toughness?: string }): string {
  const colors = "WUBRG".split("").filter((c) => t.colors?.includes(c)).join("");
  const pt = t.power !== undefined && t.toughness !== undefined ? `${t.power}/${t.toughness}` : "-";
  return `${t.name.replace(/ token$/i, "").trim().toLowerCase()}|${colors}|${pt}`;
}

export interface TokenSource {
  /** The deck card that makes it. */
  card: string;
  /** That card's token printing (Scryfall id). */
  tokenId: string;
  released?: string;
  commander: boolean;
}

export interface DeckToken {
  identity: string;
  name: string;
  /** Type line of the default printing, e.g. "Token Creature — Goblin". */
  typeLine?: string;
  /** Deck cards that make it, commanders first, then newest first. */
  sources: TokenSource[];
  /** The printing used unless you pick another. */
  defaultId: string;
  /** Your pick for this deck, if any. */
  chosenId?: string;
  /** chosenId ?? defaultId */
  id: string;
}

/**
 * The deck's tokens. `card` looks up a deck card's Scryfall data, `token` a token printing by id
 * (both from the cache: fetch them first). Cards or tokens not loaded yet are skipped.
 */
export function deckTokens(
  cards: DeckCard[],
  card: (c: DeckCard) => ScryCard | undefined,
  token: (id: string) => ScryCard | undefined,
  chosen: Record<string, string> = {},
): DeckToken[] {
  const byIdentity = new Map<string, { name: string; typeLine?: string; sources: TokenSource[] }>();
  for (const c of cards) {
    if (c.board !== "main" && c.board !== "commander") continue;
    const sc = card(c);
    for (const part of sc?.all_parts ?? []) {
      const t = token(part.id);
      if (!t || isEmblem(t)) continue;
      const face = t.card_faces?.[0];
      const id = tokenIdentity({ name: t.name, colors: t.colors ?? face?.color_indicator, power: t.power ?? face?.power, toughness: t.toughness ?? face?.toughness });
      const entry = byIdentity.get(id) ?? { name: t.name, typeLine: t.type_line, sources: [] };
      if (!entry.sources.some((s) => s.card === c.name)) {
        entry.sources.push({ card: c.name, tokenId: t.id, released: sc?.released_at, commander: c.board === "commander" });
      }
      byIdentity.set(id, entry);
    }
  }
  const list: DeckToken[] = [];
  for (const [identity, e] of byIdentity) {
    e.sources.sort((a, b) => Number(b.commander) - Number(a.commander) || (b.released ?? "").localeCompare(a.released ?? ""));
    const defaultId = e.sources[0].tokenId;
    const chosenId = chosen[identity];
    list.push({ identity, name: e.name, typeLine: e.typeLine, sources: e.sources, defaultId, chosenId, id: chosenId ?? defaultId });
  }
  return list.sort((a, b) => a.name.localeCompare(b.name) || a.identity.localeCompare(b.identity));
}

/** Every token printing the deck's cards point at (to fetch before calling `deckTokens`). */
export function tokenIds(cards: DeckCard[], card: (c: DeckCard) => ScryCard | undefined): string[] {
  const ids = new Set<string>();
  for (const c of cards) for (const p of card(c)?.all_parts ?? []) ids.add(p.id);
  return [...ids];
}

/** What a game needs: the printing to use for each kind of token. */
export function tokenArtMap(tokens: DeckToken[]): Record<string, string> {
  return Object.fromEntries(tokens.map((t) => [t.identity, t.id]));
}

function isEmblem(t: ScryCard) {
  return /emblem/i.test(t.type_line ?? "") || t.layout === "emblem";
}
