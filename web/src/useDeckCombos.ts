// A deck's combos from Commander Spellbook: what's stored with it, looked up again (once the deck has
// settled) when its cards have changed. Used by the deck editor and in games.
import { useAction, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { errorMessage } from "./app/errors";
import { hasCommander } from "./deckFormats";
import { deckKey, type DeckCombos } from "./game/spellbook";

/** After the last change to the deck. */
const SETTLE_MS = 4000;
const AGAIN_MS = 12_000;

export function useDeckCombos(deckId: string | undefined): { found: DeckCombos | null; looking: boolean; error: string; retry: () => void } {
  const deck = useQuery(api.decks.get, deckId ? { id: deckId } : "skip");
  const found = useQuery(api.combos.forDeck, deckId ? { id: deckId } : "skip");
  const lookUp = useAction(api.combos.lookUp);
  const [error, setError] = useState("");
  const [tries, setTries] = useState(0);
  const key = deck && hasCommander(deck.format) ? deckKey(deck.cards) : null;
  const due = key !== null && found !== undefined && found?.key !== key;
  const id = deck?._id as Id<"decks"> | undefined;
  useEffect(() => {
    if (!due || !id) return;
    let timer = 0;
    let stopped = false;
    const ask = () => {
      lookUp({ id })
        .then((r) => {
          if (!stopped && r === "wait") timer = window.setTimeout(ask, AGAIN_MS);
        })
        .catch((e) => !stopped && setError(errorMessage(e)));
    };
    setError("");
    timer = window.setTimeout(ask, SETTLE_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [due, id, key, tries, lookUp]);
  const retry = useCallback(() => setTries((n) => n + 1), []);
  return { found: found ?? null, looking: due && !error, error, retry };
}
