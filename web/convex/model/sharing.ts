// Sharing decks (convex/sharing.ts, convex/social.ts): who can see a deck, its share link, what the
// deck search matches, and comment rules. Pure (no Convex imports), so `node --test` can run it.

import type { DeckCard } from "./deckRules";

/** Public: in the deck search and open to anyone with the link. Unlisted: the link only. Private: the owner only. */
export type Visibility = "public" | "unlisted" | "private";
export const VISIBILITIES: readonly Visibility[] = ["public", "unlisted", "private"];
/** New decks start public. Decks saved before sharing existed have no visibility: private. */
export const NEW_DECK_VISIBILITY: Visibility = "public";

export const visibilityOf = (v: string | undefined): Visibility => (v === "public" || v === "unlisted" ? v : "private");

/** Whether someone other than the owner can open the deck by its link. */
export const isShared = (v: string | undefined) => visibilityOf(v) !== "private";

/** Share links (`#/d/<key>`): no 0/O/1/I/l, so a link copied by hand comes out right. */
const KEY_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
export const SHARE_KEY_LENGTH = 10;
export const SHARE_KEY_RE = new RegExp(`^[${KEY_ALPHABET}]{${SHARE_KEY_LENGTH}}$`);

/** A new share key from random bytes (about 57 bits: unlisted links can't be guessed). */
export function makeShareKey(random: Uint8Array): string {
  if (random.length < SHARE_KEY_LENGTH) throw new Error("Need more random bytes");
  let out = "";
  for (let i = 0; i < SHARE_KEY_LENGTH; i++) out += KEY_ALPHABET[random[i] % KEY_ALPHABET.length];
  return out;
}

/** How card names are compared in the search: lower case, single spaces. */
export const cardKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** The keys a card is found by: its name, and for a two-faced card each face's name too. */
export function keysOfName(name: string): string[] {
  const full = cardKey(name);
  const faces = full.includes(" // ") ? full.split(" // ").map((f) => f.trim()).filter(Boolean) : [];
  return [...new Set([full, ...faces])];
}

/** Every key a deck's played cards (commander, main deck, sideboard) are found by, without repeats. */
export function deckCardKeys(cards: DeckCard[]): string[] {
  return [...new Set(cards.filter((c) => c.board !== "maybe").flatMap((c) => keysOfName(c.name)))];
}

/** What to add and remove to turn the indexed keys `had` into `want`. */
export function keyDiff(had: string[], want: string[]): { add: string[]; remove: string[] } {
  const h = new Set(had);
  const w = new Set(want);
  return { add: [...w].filter((k) => !h.has(k)), remove: [...h].filter((k) => !w.has(k)) };
}

/** The text the deck search's name box matches: the deck's name and its author. */
export function searchText(name: string, author: string | undefined): string {
  return [name, author].filter(Boolean).join(" ");
}

/** A deck's commanders, as the commander box matches them. */
export const commanderText = (cards: DeckCard[]) => cards.filter((c) => c.board === "commander").map((c) => c.name).join(" ");

export const WUBRG = "WUBRG";
/** A deck's colors as the client reports them: WUBRG letters in order, "" for colorless. */
export function cleanColors(colors: string | undefined): string | undefined {
  if (colors === undefined) return undefined;
  const up = colors.toUpperCase();
  return [...WUBRG].filter((c) => up.includes(c)).join("");
}

/** How the color filter compares: the deck's colors are exactly these, include them all, or stay within them. */
export type ColorMatch = "exact" | "including" | "within";

export function colorsMatch(deck: string | undefined, wanted: string, how: ColorMatch): boolean {
  if (deck === undefined) return false;
  const d = new Set(deck);
  const w = new Set(cleanColors(wanted));
  if (how === "including") return [...w].every((c) => d.has(c));
  if (how === "within") return [...d].every((c) => w.has(c));
  return d.size === w.size && [...w].every((c) => d.has(c));
}

export interface DeckFilter {
  /** Matches the deck's name or its author's username. */
  text?: string;
  commander?: string;
  /** Card names the deck must have, every one. */
  cards?: string[];
  format?: string;
  colors?: string;
  colorMatch?: ColorMatch;
  bracket?: number;
}

/** What the search needs of a deck to filter it. */
export interface Searchable {
  name: string;
  format: string;
  cards: DeckCard[];
  colors?: string;
  bracket?: number;
  author?: string;
}

const words = (s: string) => cardKey(s).split(" ").filter(Boolean);

/** Every word of `query` starts a word of `text` (or appears in it), ignoring case. */
export function textMatches(text: string, query: string): boolean {
  const hay = cardKey(text);
  return words(query).every((w) => hay.includes(w));
}

export const MAX_SEARCH_CARDS = 10;
export const MAX_SEARCH_TEXT = 100;

/** Whether a deck passes every filter that's set. */
export function deckMatches(d: Searchable, f: DeckFilter): boolean {
  if (f.format && d.format !== f.format) return false;
  if (f.bracket && d.bracket !== f.bracket) return false;
  // "" asks for colorless decks.
  if (f.colors !== undefined && !colorsMatch(d.colors, f.colors, f.colorMatch ?? "exact")) return false;
  if (f.text?.trim() && !textMatches(searchText(d.name, d.author), f.text)) return false;
  if (f.commander?.trim() && !textMatches(commanderText(d.cards), f.commander)) return false;
  if (f.cards?.length) {
    const have = new Set(deckCardKeys(d.cards));
    if (!f.cards.every((c) => have.has(cardKey(c)))) return false;
  }
  return true;
}

// ---- Comments ----

export const MAX_COMMENT = 2000;
/** Replies nest this deep; a reply to one that deep stays at that depth. */
export const MAX_COMMENT_DEPTH = 6;
/** The least time between two comments from one player. */
export const COMMENT_GAP_MS = 3000;
export const MAX_COMMENTS_PER_DECK = 2000;

export class CommentError extends Error {}

/** A comment's text tidied: trimmed, at most two blank lines in a row. Throws CommentError if it's empty or too long. */
export function cleanComment(body: string): string {
  const text = body.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new CommentError("Write something first.");
  if (text.length > MAX_COMMENT) throw new CommentError(`Comments are at most ${MAX_COMMENT} characters.`);
  return text;
}

export interface CommentNode<T> {
  comment: T;
  replies: CommentNode<T>[];
}

/**
 * Comments arranged as threads: top-level comments newest first, replies under the comment they
 * answer, oldest first (so a conversation reads down). A reply whose parent is gone is shown at the top.
 */
export function threads<T extends { _id: string; parentId?: string; createdAt: number }>(comments: T[]): CommentNode<T>[] {
  const nodes = new Map(comments.map((c) => [c._id, { comment: c, replies: [] as CommentNode<T>[] }]));
  const top: CommentNode<T>[] = [];
  for (const c of [...comments].sort((a, b) => a.createdAt - b.createdAt)) {
    const node = nodes.get(c._id)!;
    const parent = c.parentId ? nodes.get(c.parentId) : undefined;
    if (parent) parent.replies.push(node);
    else top.push(node);
  }
  return top.reverse();
}

// ---- Views ----

const DAY_MS = 24 * 3600 * 1000;
/** The day a view falls on: a viewer counts once a day. */
export const viewDay = (now: number) => Math.floor(now / DAY_MS);
/** Views are remembered this long (to count each viewer once a day), then forgotten. */
export const VIEW_KEEP_MS = 2 * DAY_MS;
/** A browser's own id for counting views when nobody's signed in. */
export const VIEWER_RE = /^[A-Za-z0-9_-]{8,64}$/;
