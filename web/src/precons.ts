// Preconstructed decks players can copy into their account (pages/Precons.tsx). The data is
// public/precons.json, built from Forge's deck files by scripts/precons.ts.
import type { DeckCard } from "../convex/model/deckRules";

/** [quantity, name, Scryfall set code, collector number]. Set and number are "" when unknown. */
export type PreconCard = [number, string, string, string];

export interface Precon {
  /** Stable id from the file name. */
  id: string;
  name: string;
  /** Its tab: Secret Lair Commander decks, or every other Commander precon. */
  kind: "commander" | "secret-lair";
  /** Scryfall set code of the product, e.g. "tdc". "" when unknown. */
  set: string;
  setName: string;
  /** Release date, "YYYY-MM-DD", or just "YYYY" when only the year is known. "" when unknown. */
  date: string;
  description?: string;
  commander: PreconCard[];
  main: PreconCard[];
  side: PreconCard[];
}

let loading: Promise<Precon[]> | undefined;

/** All precons, newest first (the file is already in that order). */
export function loadPrecons(): Promise<Precon[]> {
  loading ??= fetch(`${import.meta.env.BASE_URL}precons.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`Couldn't load the precon list (${res.status}).`);
      return res.json() as Promise<Precon[]>;
    })
    .catch((e) => {
      loading = undefined; // let the next visit try again
      throw e;
    });
  return loading;
}

const toCard = (board: DeckCard["board"]) => ([quantity, name, set, collectorNumber]: PreconCard): DeckCard => {
  const c: DeckCard = { name, quantity, board };
  if (set) c.set = set;
  if (collectorNumber) c.collectorNumber = collectorNumber;
  return c;
};

/** The precon as deck entries, before Scryfall picks the exact printings. */
export function deckCards(p: Precon): DeckCard[] {
  return [...p.commander.map(toCard("commander")), ...p.main.map(toCard("main")), ...p.side.map(toCard("side"))];
}

/** Commander + main deck size. */
export function cardCount(p: Precon): number {
  return [...p.commander, ...p.main].reduce((n, c) => n + c[0], 0);
}


const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2018-08-10" → "Aug 2018"; "2023" stays "2023". */
export function releaseLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(date);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : date;
}

/** Case-insensitive match on deck name, commanders, set name and set code. */
export function matches(p: Precon, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [p.name, p.setName, p.set, ...p.commander.map((c) => c[1])].some((s) => s.toLowerCase().includes(q));
}

// ---- Baked card data ------------------------------------------------------------------
// `npm run precons` also writes public/precon-cards/<deck id>.json: what the deck view needs for
// each card, looked up on Scryfall ahead of time. Opening a deck is then one small fetch from our
// own site instead of rate-limited Scryfall lookups. Card details still come from Scryfall.

/** [Scryfall id, set, collector number, mana value, type line, mana cost, 1 if it has a back image]. */
export type PreconCardData = [string, string, string, number, string, string, 0 | 1];

/** One file per deck: card key (see `cardKey`) → data, or null when Scryfall doesn't know the card. */
export interface PreconCardsFile {
  cards: Record<string, PreconCardData | null>;
}

/** The key of a deck entry in a PreconCardsFile. */
export const cardKey = (name: string, set = "", collectorNumber = "") => `${name}|${set}|${collectorNumber}`;

/** Every card key a deck needs. */
export const deckKeys = (p: Precon): string[] => [...new Set([...p.commander, ...p.main, ...p.side].map((c) => cardKey(c[1], c[2], c[3])))];

/** Scryfall's image URL for a card id (their CDN serves the same path without the cache-busting query). */
export function cardImage(id: string, size: "small" | "normal" | "large" | "art_crop", back = false): string {
  return `https://cards.scryfall.io/${size}/${back ? "back" : "front"}/${id[0]}/${id[1]}/${id}.jpg`;
}

const cardFiles = new Map<string, Promise<PreconCardsFile>>();

/** The deck's baked card data. Fetched once per visit; the browser caches the file too. */
export function loadPreconCards(p: Precon): Promise<PreconCardsFile> {
  let hit = cardFiles.get(p.id);
  if (!hit) {
    hit = fetch(`${import.meta.env.BASE_URL}precon-cards/${p.id}.json`).then((res) => {
      if (!res.ok) throw new Error(`No card data for ${p.name} (${res.status})`);
      return res.json() as Promise<PreconCardsFile>;
    });
    hit.catch(() => cardFiles.delete(p.id)); // try again next time
    cardFiles.set(p.id, hit);
  }
  return hit;
}
