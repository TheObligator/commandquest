// A bar along the bottom of the deck editor: the deck's card count, its bracket, and how many cards
// of each type it has. Hovering (or focusing) a type lists its subtypes.
import type { DeckCard } from "../../convex/model/deckRules";
import { bracketName } from "../brackets";
import * as scry from "../scryfall";
import { BAR_TYPES, typeCounts } from "../typecounts";
import { TypeIcon } from "./TypeIcon";

const plural = (t: string) => (t === "Sorcery" ? "Sorceries" : `${t}s`);

export function DeckBar(props: { cards: DeckCard[]; count: string; countOk: boolean; bracket?: number; commander: boolean }) {
  return (
    <div className="deck-bar" role="region" aria-label="Deck summary">
      <span className="deck-bar-count" data-ok={String(props.countOk)} title="Main deck and commanders">{props.count}</span>
      {props.commander && (
        <span className="deck-bar-bracket" title="This deck's Commander bracket (set it under the deck)">
          {props.bracket ? <>Bracket {props.bracket} <span className="muted">· {bracketName(props.bracket)}</span></> : <span className="muted">No bracket</span>}
        </span>
      )}
      <DeckTypeCounts cards={props.cards} />
    </div>
  );
}

/** Icons with how many cards of each type the deck has; hovering one lists its subtypes. */
export function DeckTypeCounts(props: { cards: DeckCard[]; className?: string }) {
  const counted = typeCounts(
    props.cards.flatMap((c) => {
      const s = c.board === "main" || c.board === "commander" ? scry.cached(c) : undefined;
      return s ? [{ quantity: c.quantity, typeLine: s.type_line ?? "" }] : [];
    }),
  );
  const types = BAR_TYPES.filter((t) => t !== "Kindred" || counted.has(t));
  return (
    <ul className={`deck-bar-types${props.className ? ` ${props.className}` : ""}`} aria-label="Cards of each type">
      {types.map((t) => {
        const c = counted.get(t);
        const n = c?.count ?? 0;
        return (
          <li key={t} className={n ? "" : "none"} tabIndex={n ? 0 : -1} aria-label={`${n} ${n === 1 ? t.toLowerCase() : plural(t).toLowerCase()}`}>
            <TypeIcon type={t} />
            <span>{n}</span>
            {n > 0 && (
              <div className="deck-bar-tip" role="tooltip">
                <strong>{n} {n === 1 ? t : plural(t)}</strong>
                {c!.subtypes.length ? (
                  <ul>
                    {c!.subtypes.map((s) => <li key={s.name}><span>{s.name}</span><span className="muted">{s.count}</span></li>)}
                  </ul>
                ) : (
                  <p className="muted small">No subtypes</p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
