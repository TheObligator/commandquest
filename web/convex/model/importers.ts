// Parsers for deck-site APIs (Moxfield, Archidekt). Pure, so `node --test` can run them.
// Ported from the old Java server's DeckUrlImporter. The fetching happens in ../importDeck.ts.

import type { Board, DeckCard } from "./deckRules";

export interface ImportedDeck {
  name: string;
  format: string;
  source: "moxfield" | "archidekt";
  cards: DeckCard[];
}

export type DeckSource = { site: "moxfield"; id: string; apiUrl: string } | { site: "archidekt"; id: string; apiUrl: string };

const MOXFIELD = /^https?:\/\/(?:www\.)?moxfield\.com\/decks\/([A-Za-z0-9_-]+)/;
const ARCHIDEKT = /^https?:\/\/(?:www\.)?archidekt\.com\/(?:api\/)?decks\/(\d+)/;

/**
 * Which API to call for a deck link. Only these hosts are ever contacted, so the import can't be
 * used to make our backend fetch arbitrary URLs.
 */
export function deckSource(url: string): DeckSource | null {
  const u = url.trim();
  let m = MOXFIELD.exec(u);
  if (m) return { site: "moxfield", id: m[1], apiUrl: `https://api2.moxfield.com/v3/decks/all/${m[1]}` };
  m = ARCHIDEKT.exec(u);
  if (m) return { site: "archidekt", id: m[1], apiUrl: `https://archidekt.com/api/decks/${m[1]}/` };
  return null;
}

const ORDER: Board[] = ["commander", "main", "side", "maybe"];
const byBoard = (a: DeckCard, b: DeckCard) => ORDER.indexOf(a.board) - ORDER.indexOf(b.board) || a.name.localeCompare(b.name);
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
const KNOWN_FORMATS = new Set(["commander", "conquest", "standard", "pioneer", "modern", "legacy", "vintage", "pauper"]);

function card(name: string, quantity: number, board: Board, scryfallId?: string, set?: string, cn?: string): DeckCard {
  const c: DeckCard = { name, quantity, board };
  if (scryfallId) c.scryfallId = scryfallId;
  if (set) c.set = set;
  if (cn) c.collectorNumber = cn;
  return c;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Moxfield's v3 deck JSON (boards under `boards`), or the older v2 shape (boards at the top). */
export function parseMoxfield(d: any): ImportedDeck {
  const boards: Record<string, Board> = { commanders: "commander", mainboard: "main", sideboard: "side", companions: "side", maybeboard: "maybe" };
  const cards: DeckCard[] = [];
  for (const [key, board] of Object.entries(boards)) {
    const entries = d?.boards ? d.boards[key]?.cards : d?.[key];
    for (const e of Object.values(entries ?? {}) as any[]) {
      const name = text(e?.card?.name);
      const qty = Number(e?.quantity ?? 1);
      if (!name || !(qty >= 1)) continue;
      cards.push(card(name, qty, board, text(e.card.scryfall_id), text(e.card.set), text(e.card.cn)));
    }
  }
  const f = text(d?.format) ?? "";
  return { name: text(d?.name) ?? "Imported deck", format: KNOWN_FORMATS.has(f) ? f : f ? "other" : "commander", source: "moxfield", cards: cards.sort(byBoard) };
}

const ARCHIDEKT_FORMATS: Record<number, string> = { 1: "standard", 2: "modern", 3: "commander", 4: "legacy", 5: "vintage", 6: "pauper" };

/** Archidekt's deck JSON. Cards in categories left out of the deck go to the maybeboard (or sideboard). */
export function parseArchidekt(d: any): ImportedDeck {
  const included = new Map<string, boolean>();
  for (const c of d?.categories ?? []) included.set(String(c?.name), c?.includedInDeck !== false);
  const cards: DeckCard[] = [];
  for (const e of d?.cards ?? []) {
    const name = text(e?.card?.oracleCard?.name);
    const qty = Number(e?.quantity ?? 1);
    if (!name || !(qty >= 1)) continue;
    const cats: string[] = (e.categories ?? []).map(String);
    let board: Board = "main";
    if (cats.includes("Commander")) board = "commander";
    else if (cats.length && included.get(cats[0]) === false) board = cats[0].toLowerCase().includes("side") ? "side" : "maybe";
    cards.push(card(name, qty, board, text(e.card.uid), text(e.card.edition?.editioncode), text(e.card.collectorNumber)));
  }
  return { name: text(d?.name) ?? "Imported deck", format: ARCHIDEKT_FORMATS[Number(d?.deckFormat)] ?? "other", source: "archidekt", cards: cards.sort(byBoard) };
}
