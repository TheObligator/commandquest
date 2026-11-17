// Which of your decks can start a game (src/deckcheck.ts), with Scryfall data loaded for their cards.
import { useEffect, useMemo, useState } from "react";
import type { DeckCard } from "../convex/model/deckRules";
import { useCardSupport } from "./cardsupport";
import { gameProblems, type DeckToCheck } from "./deckcheck";
import * as scry from "./scryfall";

/**
 * For each deck (by id), why it can't start a game ([] when it can). Undefined until the decks'
 * card data is loaded. Decks whose cards Scryfall couldn't be asked about count as unchecked:
 * they get no problems, and the game server has the last word.
 */
export function useGameProblems<D extends DeckToCheck & { _id: string }>(decks: D[] | undefined): Map<string, string[]> | undefined {
  const support = useCardSupport();
  const [loaded, setLoaded] = useState<{ decks: D[]; failed: boolean } | null>(null);

  useEffect(() => {
    if (!decks) return;
    let live = true;
    const cards: DeckCard[] = decks.flatMap((d) => d.cards.filter((c) => c.board === "main" || c.board === "commander"));
    scry.resolve(cards).then(
      () => live && setLoaded({ decks, failed: false }),
      () => live && setLoaded({ decks, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [decks]);

  return useMemo(() => {
    // Card support (which cards Forge has) usually loads first; if it hasn't, check without it.
    if (!decks || loaded?.decks !== decks) return undefined;
    const card = (c: DeckCard) => scry.cachedExact(c) ?? scry.cached(c);
    return new Map(decks.map((d) => [d._id, loaded.failed ? [] : gameProblems(d, card, support)]));
  }, [decks, support, loaded]);
}
