// The colors of the decks in the deck list (src/deckSort.ts), with Scryfall data loaded for their cards.
import { useEffect, useMemo, useState } from "react";
import type { CardRef, DeckCard } from "../convex/model/deckRules";
import { colorsOf } from "./deckGroups";
import { deckColors } from "./deckSort";
import * as scry from "./scryfall";

interface ColoredDeck {
  _id: string;
  commanders: string[];
  colorCards: CardRef[];
  extraColor?: string;
}

const entry = (c: CardRef): DeckCard => ({ ...c, quantity: 1, board: "main" });

/** Each deck's colors by id ("" = colorless); decks whose cards aren't known yet are missing. `done`: nothing more is coming. */
export function useDeckColors(decks: ColoredDeck[] | undefined, enabled: boolean): { colors: Map<string, string>; done: boolean } {
  const [done, setDone] = useState<ColoredDeck[]>();

  useEffect(() => {
    if (!decks || !enabled) return;
    let live = true;
    const finish = () => live && setDone(decks);
    // Commanders first: they're most decks' colors, and few cards. Long lists follow.
    const of = (list: ColoredDeck[]) => list.flatMap((d) => d.colorCards.map(entry));
    scry
      .resolve(of(decks.filter((d) => d.commanders.length)))
      .then(() => {
        const rest = decks.filter((d) => !d.commanders.length && d.colorCards.length);
        if (!rest.length) return;
        if (live) setDone([]); // shows the commander decks' colors meanwhile
        return scry.resolve(of(rest));
      })
      .then(finish, finish);
    return () => {
      live = false;
    };
  }, [decks, enabled]);

  return useMemo(() => {
    const colors = new Map<string, string>();
    for (const d of decks ?? []) {
      const led = d.commanders.length > 0;
      const cards = d.colorCards.map((x) => {
        const card = scry.cachedExact(entry(x)) ?? scry.cached(entry(x));
        return card && (led ? card.color_identity : colorsOf(card));
      });
      const c = deckColors(cards, led, d.extraColor);
      if (c !== undefined) colors.set(d._id, c);
    }
    return { colors, done: done === decks };
  }, [decks, done]);
}
