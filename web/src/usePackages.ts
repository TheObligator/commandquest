// Your packages, with Scryfall data loaded for their cards.
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { DeckCard } from "../convex/model/deckRules";
import * as scry from "./scryfall";

export interface Package {
  _id: Id<"packages">;
  name: string;
  note?: string;
  cards: DeckCard[];
  updatedAt: number;
}

/** `packages` is undefined while they load; `data` is how looking up their cards is going. */
export function usePackages(): { packages: Package[] | undefined; data: "loading" | "ready" | "failed"; retry: () => void } {
  const packages = useQuery(api.packages.list);
  const [done, setDone] = useState<{ packages: Package[]; ok: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!packages) return;
    let live = true;
    scry.resolve(packages.flatMap((p) => p.cards)).then(
      () => live && setDone({ packages, ok: true }),
      () => live && setDone({ packages, ok: false }),
    );
    return () => {
      live = false;
    };
  }, [packages, attempt]);
  const data = !packages || done?.packages !== packages ? "loading" : done.ok ? "ready" : "failed";
  return { packages, data, retry: () => (setDone(null), setAttempt((n) => n + 1)) };
}

export const cardData = (c: DeckCard) => scry.cachedExact(c) ?? scry.cached(c);

const missingCards = (p: Package) => p.cards.some((c) => !cardData(c));
/** Whether a package's cards can be judged already: their data is all here, or its lookup is over. */
export const isKnown = (p: Package, data: "loading" | "ready" | "failed") => data === "ready" || !missingCards(p);
