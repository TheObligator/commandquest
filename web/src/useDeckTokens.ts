// Loads what a deck's token list needs from Scryfall (the deck's cards, then the token printings
// they point at) and returns the list (src/tokens.ts) with your picks applied.
import { useEffect, useMemo, useState } from "react";
import type { DeckCard } from "../convex/model/deckRules";
import { cached, cachedById, cardsById, resolve } from "./scryfall";
import { deckTokens, tokenIds, type DeckToken } from "./tokens";

export function useDeckTokens(cards: DeckCard[] | undefined, picks: { identity: string; scryfallId: string }[] | undefined) {
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const key = cards?.map((c) => `${c.board}:${c.scryfallId ?? c.name}`).join("|") ?? "";
  useEffect(() => {
    if (!cards?.length) return;
    let live = true;
    setLoading(true);
    (async () => {
      await resolve(cards);
      const ids = tokenIds(cards, cached).filter((id) => !cachedById(id));
      if (ids.length) await cardsById(ids);
    })()
      .catch(() => undefined)
      .finally(() => {
        if (!live) return;
        setLoading(false);
        setVersion((v) => v + 1);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const picksKey = JSON.stringify(picks ?? []);
  const tokens: DeckToken[] = useMemo(
    () => (cards ? deckTokens(cards, cached, cachedById, Object.fromEntries((picks ?? []).map((p) => [p.identity, p.scryfallId]))) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, version, picksKey],
  );
  return { tokens, loading };
}
