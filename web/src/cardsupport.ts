// Which cards work in games. public/card-support.json (built by scripts/cardsupport.ts) lists every
// card Forge has a script for, and the ones we know misbehave. Anything else, such as a card
// Scryfall added after the last Forge merge, doesn't work yet: Forge refuses to start a game with it.
import { useEffect, useState } from "react";
import type { ScryCard } from "./scryfall";

export interface CardSupportData {
  /** Forge's card names: front faces, plus "Left // Right" for split cards. */
  cards: string[];
  /** Cards Forge has but that misbehave: name → what's wrong. */
  broken: Record<string, string>;
}

export type CardStatus = { works: true } | { works: false; missing: boolean; reason: string };

const WORKS: CardStatus = { works: true };
export const NOT_IN_FORGE = "Not in the rules engine yet, so it can't be played in a game.";

export class CardSupport {
  /** Forge's spelling of each card, by {@link norm}. */
  private readonly known: Map<string, string>;
  private readonly broken: Map<string, string>;

  constructor(data: CardSupportData) {
    this.known = new Map(data.cards.map((n) => [norm(n), n]));
    this.broken = new Map(Object.entries(data.broken).map(([n, r]) => [norm(n), r]));
  }

  /**
   * The name to send the game server: Forge's spelling when it differs from Scryfall's (Forge has
   * "All Good Things . . .", Scryfall "All Good Things..."), otherwise the name as it is.
   */
  forgeName(name: string): string {
    const n = norm(name);
    return this.known.get(n) ?? name;
  }

  /** A Scryfall card, or a deck entry's name ("Front // Back" or just the front face). */
  status(card: ScryCard | string): CardStatus {
    const names = namesOf(card);
    for (const n of names) {
      const reason = this.broken.get(n);
      if (reason) return { works: false, missing: false, reason };
    }
    if (names.some((n) => this.known.has(n))) return WORKS;
    return { works: false, missing: true, reason: NOT_IN_FORGE };
  }

  /** True when Forge has no script for the card at all, so a game can't start with it. */
  notInForge(card: ScryCard | string): boolean {
    const st = this.status(card);
    return !st.works && st.missing;
  }
}

/**
 * Case-insensitive, and blind to the few punctuation differences between Forge's and Scryfall's
 * names: dashes, ellipses, and the modifier-letter colon in Ratonhnhaké꞉ton.
 */
export function norm(name: string): string {
  return name
    .normalize("NFC")
    .toLowerCase()
    .trim()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\ua789/g, ":")
    .replace(/\s*(\.\s?){3}/g, "\u2026");
}

/** The names Forge might know a card by: the full name, then the front face. */
function namesOf(card: ScryCard | string): string[] {
  const full = typeof card === "string" ? card : card.name;
  const out = [norm(full)];
  const front = typeof card !== "string" && card.card_faces?.[0]?.name ? card.card_faces[0].name : full.split(" // ")[0];
  if (norm(front) !== out[0]) out.push(norm(front));
  return out;
}

let loading: Promise<CardSupport> | undefined;

/** Loads the list once per page; a failed load is retried next time. */
export function loadCardSupport(): Promise<CardSupport> {
  loading ??= fetch(`${import.meta.env.BASE_URL}card-support.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`card-support.json: HTTP ${r.status}`);
      return r.json() as Promise<CardSupportData>;
    })
    .then((d) => new CardSupport(d))
    .catch((e) => {
      loading = undefined;
      throw e;
    });
  return loading;
}

/** The list, or undefined while it loads (or if it couldn't load: then nothing is marked). */
export function useCardSupport(): CardSupport | undefined {
  const [support, setSupport] = useState<CardSupport>();
  useEffect(() => {
    let live = true;
    loadCardSupport().then((s) => live && setSupport(s), () => undefined);
    return () => {
      live = false;
    };
  }, []);
  return support;
}
