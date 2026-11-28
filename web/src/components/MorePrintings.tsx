// A printings window shows a card's first few printings, with "Show more" for the rest: a card with a
// hundred printings doesn't load a hundred images when you only wanted to look.
import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "../app/errors";
import { PRINTINGS_STEP, shownPrintings } from "../printings";
import * as scry from "../scryfall";

/** "Show all" fetches every page of Scryfall's list, so not for cards with thousands (basic lands). */
const SHOW_ALL_MAX = 400;

/**
 * Which of `prints` (Scryfall's first page, plus any of our own in front) the window shows. `total` is
 * how many there are in all, `nextPage` where Scryfall's list goes on, and `keep` which of its next
 * pages' cards belong in the list.
 */
export function useShownPrintings(
  prints: scry.ScryCard[] | null,
  selected: string | undefined,
  total: number,
  nextPage?: string,
  keep: (c: scry.ScryCard) => boolean = () => true,
) {
  const [limit, setLimit] = useState(PRINTINGS_STEP);
  const [extra, setExtra] = useState<scry.ScryCard[]>([]);
  const [next, setNext] = useState(nextPage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setLimit(PRINTINGS_STEP);
    setExtra([]);
    setNext(nextPage);
  }, [prints, nextPage]);

  const all = useMemo(() => {
    const seen = new Set<string>();
    return [...(prints ?? []), ...extra].filter((c) => !seen.has(c.id) && !!seen.add(c.id));
  }, [prints, extra]);
  const shown = shownPrintings(all, limit, selected);

  /** Shows the first `want`, fetching Scryfall's next pages if we don't have that many yet. */
  async function showUpTo(want: number) {
    let url = next;
    let have = all.length;
    const got: scry.ScryCard[] = [];
    setBusy(true);
    setError("");
    try {
      while (have < want && url) {
        const page = await scry.nextPage(url);
        const cards = page.cards.filter(keep);
        got.push(...cards);
        have += cards.length;
        url = page.nextPage;
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setExtra((x) => [...x, ...got]);
      setNext(url);
      setLimit(want);
    }
  }

  const count = Math.max(total, all.length);
  return { shown, more: { shown: shown.length, total: count, busy, error, showUpTo, limit } };
}

export function MorePrintings({ shown, total, busy, error, showUpTo, limit }: ReturnType<typeof useShownPrintings>["more"]) {
  if (shown >= total && !error) return null;
  const left = total - shown;
  const step = Math.min(PRINTINGS_STEP, left);
  return (
    <div className="printings-more">
      <span className="small muted">Showing {shown} of {total} printings</span>
      {error && <span className="small form-error">{error}</span>}
      <button className="btn ghost" disabled={busy} onClick={() => void showUpTo(limit + PRINTINGS_STEP)}>
        {busy ? "Loading…" : `Show ${step} more`}
      </button>
      {total <= SHOW_ALL_MAX && left > step && (
        <button className="btn ghost" disabled={busy} onClick={() => void showUpTo(total)}>Show all {total}</button>
      )}
    </div>
  );
}
