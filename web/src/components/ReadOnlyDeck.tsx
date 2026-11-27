// A deck shown read-only: by board, then card type, as stacks, a grid or a list (the precon viewer,
// shared decks). Hover shows a card; click opens its details.
import { useCallback, useMemo, useState } from "react";
import type { DeckCard } from "../../convex/model/deckRules";
import { showCardDetails } from "../carddetails";
import { useStackColumns, type CardView } from "../cardView";
import { TYPE_ORDER } from "../deckGroups";
import { toast } from "../dom";
import * as scry from "../scryfall";
import { columnSpans, columnsOf, stackColClass } from "../stackLayout";
import { useCardPreview } from "../useCardPreview";
import { CardImg } from "./CardImg";
import { FlipButton, useFlips } from "./FlipButton";
import { ManaCost } from "./ManaCost";
import { Loading, Waiting } from "./Spinner";

interface Group {
  key: string;
  label: string;
  cards: DeckCard[];
}

export type Lookup = (c: DeckCard) => scry.ScryCard | undefined;

const total = (cards: DeckCard[]) => cards.reduce((n, c) => n + c.quantity, 0);

/** One entry per name (Forge lists basic lands once per art), keeping the first printing. */
function byName(cards: DeckCard[]): DeckCard[] {
  const merged = new Map<string, DeckCard>();
  for (const c of cards) {
    const had = merged.get(c.name);
    merged.set(c.name, had ? { ...had, quantity: had.quantity + c.quantity } : c);
  }
  return [...merged.values()];
}

/** Commander, then the main deck by card type (cheapest first), then the sideboard. */
function groupsOf(all: DeckCard[], lookup: Lookup, resolved: boolean): { deck: Group[]; side: Group[] } {
  const board = (b: DeckCard["board"]) => byName(all.filter((c) => c.board === b));
  const sorted = (g: DeckCard[]) => g.sort((a, z) => (lookup(a)?.cmc ?? 0) - (lookup(z)?.cmc ?? 0) || a.name.localeCompare(z.name));
  const byType = (cards: DeckCard[], prefix: string): Group[] => {
    if (!resolved) return cards.length ? [{ key: `${prefix}cards`, label: "Cards", cards: sorted(cards) }] : [];
    const types = new Map<string, DeckCard[]>();
    for (const c of cards) {
      const t = scry.primaryType(lookup(c));
      types.set(t, [...(types.get(t) ?? []), c]);
    }
    return TYPE_ORDER.filter((t) => types.has(t)).map((t) => ({ key: prefix + t, label: t, cards: sorted(types.get(t)!) }));
  };
  const commander = board("commander");
  const side = board("side");
  return {
    deck: [...(commander.length ? [{ key: "commander", label: "Commander", cards: commander }] : []), ...byType(board("main"), "main-")],
    side: side.length ? [{ key: "side", label: "Sideboard", cards: sorted(side) }] : [],
  };
}


/**
 * `resolved`: undefined while the cards load, false if Scryfall couldn't be reached (names only).
 * `onOpening`: a card's details are loading (the caller can show a busy cursor).
 */
export function ReadOnlyDeck({ cards, lookup, resolved, view, className, onOpening, children }: {
  cards: DeckCard[];
  lookup: Lookup;
  resolved: boolean | undefined;
  view: CardView;
  className?: string;
  onOpening?: (opening: boolean) => void;
  children?: React.ReactNode;
}) {
  const [measure, stackCols] = useStackColumns();
  const [opening, setOpeningState] = useState(false);
  const setOpening = useCallback((o: boolean) => (setOpeningState(o), onOpening?.(o)), [onOpening]);
  const preview = useCardPreview();
  const flips = useFlips();
  const { deck, side } = useMemo(() => groupsOf(cards, lookup, resolved === true), [cards, lookup, resolved]);

  /** Card details need the full card (rules text, legality), from Scryfall's cache or one lookup. */
  const details = async (c: DeckCard) => {
    preview.hide();
    const id = lookup(c)?.id;
    const asked: DeckCard = id ? { ...c, scryfallId: id } : c;
    let full = scry.cachedExact(asked);
    if (!full) {
      setOpening(true);
      try {
        await scry.resolve([asked]);
      } catch {
        // Handled below.
      } finally {
        setOpening(false);
      }
      full = scry.cachedExact(asked) ?? scry.cached(c);
    }
    if (full) showCardDetails(full);
    else toast(`Couldn't load ${c.name} from Scryfall`, "error");
  };

  /** A column of overlapping cards (two or three for a big type when there's room; in the grid, whole cards). Hover shows a card, click opens details. */
  const stack = (g: Group, span = 1) => (
    <div key={g.key} className={view === "grid" ? "grid-group" : stackColClass(span)}>
      <h4>{g.label}<span className="muted"> {total(g.cards)}</span></h4>
      <div className="stack-pair">
        {columnsOf(g.cards, span).map((cards, i) => (
          <div key={i} className={`stack ${view}`}>
            {cards.map((c) => {
              const s = lookup(c);
              const face = flips.face(s);
              const img = s && scry.imageUrl(s, "normal", face);
              return (
                <div key={c.name} className="flip-host">
                  <button className="stack-card" title={s ? undefined : c.name} disabled={!s} onClick={() => void details(c)} aria-label={`${c.quantity} × ${c.name}: card details`} {...preview.handlers(s, face)}>
                    {img ? <CardImg src={img} name={c.name} alt="" loading="lazy" /> : <span className="noimg">{c.name}</span>}
                    {img && <span className="tile-name" aria-hidden="true">{c.name}</span>}
                    {c.quantity > 1 && <span className="stack-qty">×{c.quantity}</span>}
                  </button>
                  <FlipButton card={s} face={face} onFlip={flips.toggle} />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );

  const list = (g: Group) => (
    <div key={g.key} className="type-group">
      <h4>{g.label}<span className="muted"> {total(g.cards)}</span></h4>
      <ul className="flat">
        {g.cards.map((c) => {
          const s = lookup(c);
          return (
            <li key={c.name} className="card-row" {...preview.handlers(s)}>
              <span className="qty">{c.quantity}</span>
              {s ? <button className="cname" title="Card details" onClick={() => void details(c)}>{c.name}</button> : <span className="cname">{c.name}</span>}
              {s && <ManaCost cost={s.mana_cost ?? s.card_faces?.map((f) => f.mana_cost).filter(Boolean).join(" // ")} />}
            </li>
          );
        })}
      </ul>
    </div>
  );

  const section = (title: string, groups: Group[]) =>
    groups.length > 0 && (
      <section className="board">
        <h2>{title}<span className="muted"> {groups.reduce((n, g) => n + total(g.cards), 0)}</span></h2>
        {view === "list" ? (
          <div className="type-groups">{groups.map(list)}</div>
        ) : view === "grid" ? (
          <div className="grid-groups">{groups.map((g) => stack(g))}</div>
        ) : (
          (() => {
            const spans = columnSpans(groups.map((g) => g.cards.length), stackCols);
            return <div className="stack-groups" ref={measure}>{groups.map((g, i) => stack(g, spans[i]))}</div>;
          })()
        )}
      </section>
    );

  return (
    <div className={className} onScroll={preview.hide}>
      {children}
      {resolved === undefined ? (
        <Loading text="Loading the cards…" slow="Still loading the cards… Scryfall is slow right now." />
      ) : (
        <>
          {resolved === false && <p className="muted small">Couldn't reach Scryfall, so only card names are shown.</p>}
          {section("Deck", deck)}
          {section("Sideboard", side)}
        </>
      )}
      {opening && <div className="game-wait"><Waiting text="Loading the card…" className="" /></div>}
      {preview.element}
    </div>
  );
}
