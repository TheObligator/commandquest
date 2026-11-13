// Deck-editor search: a name box with a suggestions dropdown, and a full search results page.
import { useEffect, useRef, useState } from "react";
import type { Board, DeckCard } from "../../convex/model/deckRules";
import { errorMessage } from "../app/errors";
import { showCardDetails } from "../carddetails";
import { useCardSupport } from "../cardsupport";
import { CardMenu } from "../components/CardMenu";
import { cardLegality, isCommanderEligible } from "../formats/conquest";
import * as scry from "../scryfall";
import { BOARDS, boardLabel } from "./boards";

/** The ⓘ button, drawn in CSS (the Unicode glyph renders badly in many fonts). */
export function InfoButton({ label, onClick, className = "" }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button className={`info-btn ${className}`} aria-label={label} title={label} onClick={onClick}>
      <span aria-hidden="true">i</span>
    </button>
  );
}

const canCommand = (c: scry.ScryCard, format: string) =>
  format === "conquest" ? isCommanderEligible(c) : /Legendary.*Creature|can be your commander/i.test(`${c.type_line} ${c.oracle_text ?? ""}`);

// ---- Name box with suggestions -----------------------------------------------------------

/**
 * Typing shows up to 8 matching card names. Clicking one (or ↓/↑ then Enter) adds that card.
 * Enter on the typed text opens the full results page.
 */
export function SearchBox(props: { onPick: (name: string) => void; onSubmit: (query: string) => void; autoFocus?: boolean; initial?: string }) {
  const [q, setQ] = useState(props.initial ?? "");
  const [names, setNames] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  function onInput(value: string) {
    setQ(value);
    setActive(-1);
    clearTimeout(timer.current);
    const mine = ++seq.current;
    // Scryfall syntax ("t:dragon c:r") isn't a name: no suggestions, Enter searches.
    if (value.trim().length < 2 || /[:<>=]/.test(value)) {
      setNames([]);
      return;
    }
    timer.current = window.setTimeout(async () => {
      const found = await scry.autocomplete(value).catch(() => []);
      if (mine === seq.current) {
        setNames(found.slice(0, 8));
        setOpen(true);
      }
    }, 200);
  }

  function pick(name: string) {
    props.onPick(name);
    setOpen(false);
    setActive(-1);
    setQ("");
    setNames([]);
  }

  function onKey(e: React.KeyboardEvent) {
    const shown = open ? names : [];
    if (e.key === "ArrowDown" && shown.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % shown.length);
    } else if (e.key === "ArrowUp" && shown.length) {
      e.preventDefault();
      setActive((a) => (a <= 0 ? shown.length - 1 : a - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(timer.current);
      if (active >= 0 && shown[active]) pick(shown[active]);
      else if (q.trim()) {
        setOpen(false);
        props.onSubmit(q.trim());
      }
    }
  }

  return (
    <div className="suggest" ref={box}>
      <input
        type="search"
        placeholder='Card name, or Scryfall search like "t:dragon c:r". Enter for all results'
        aria-label="Search cards"
        role="combobox"
        aria-expanded={open && names.length > 0}
        aria-controls="suggest-list"
        aria-activedescendant={active >= 0 ? `suggest-${active}` : undefined}
        autoComplete="off"
        value={q}
        autoFocus={props.autoFocus}
        onChange={(e) => onInput(e.target.value)}
        onFocus={() => names.length && setOpen(true)}
        onKeyDown={onKey}
      />
      {open && names.length > 0 && (
        <ul className="suggest-list" id="suggest-list" role="listbox">
          {names.map((n, i) => (
            <li
              key={n}
              id={`suggest-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : undefined}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(n)}
              onMouseEnter={() => setActive(i)}
            >
              <span>{n}</span>
              <span className="suggest-hint">add</span>
            </li>
          ))}
          <li className="suggest-all" role="option" aria-selected={false} onPointerDown={(e) => e.preventDefault()} onClick={() => (setOpen(false), props.onSubmit(q.trim()))}>
            See all results for “{q.trim()}” <kbd>Enter</kbd>
          </li>
        </ul>
      )}
    </div>
  );
}

// ---- Full results page -----------------------------------------------------------------

export function SearchResults(props: {
  query: string;
  format: string;
  deck: DeckCard[];
  defaultBoard: Board;
  onDefaultBoard: (b: Board) => void;
  onAdd: (c: scry.ScryCard, b: Board) => void;
  onQty: (entry: DeckCard, q: number) => void;
  onSearch: (q: string) => void;
  onPickName: (name: string) => void;
  onClose: () => void;
}) {
  const [cards, setCards] = useState<scry.ScryCard[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [next, setNext] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const support = useCardSupport();

  useEffect(() => {
    let live = true;
    setCards([]);
    setTotal(null);
    setError("");
    scry.search(props.query).then(
      (p) => live && (setCards(p.cards), setTotal(p.total), setNext(p.nextPage)),
      (e) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, [props.query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open], .card-menu")) props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  async function more() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const p = await scry.nextPage(next);
      setCards((c) => [...c, ...p.cards]);
      setNext(p.nextPage);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  /** This card's entries in the deck (one per board it's on). */
  const entries = (c: scry.ScryCard) => {
    const name = scry.deckName(c).toLowerCase();
    return props.deck.filter((d) => d.name.toLowerCase() === name);
  };

  return (
    <section className="panel search-page">
      <div className="search-page-head">
        <button className="btn ghost small" onClick={props.onClose}>← Back to deck</button>
        <div className="search-page-box">
          <SearchBox key={props.query} initial={props.query} onSubmit={props.onSearch} onPick={props.onPickName} />
        </div>
        <label className="inline small muted">
          + Add goes to{" "}
          <select value={props.defaultBoard} onChange={(e) => props.onDefaultBoard(e.target.value as Board)}>
            {BOARDS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </label>
      </div>
      <p className="muted small">
        {error ? <span className="form-error">{error}</span> : total === null ? "Searching…" : total ? `${total.toLocaleString()} cards for “${props.query}”` : `No cards found for “${props.query}”.`}
      </p>
      <div className="search-grid">
        {cards.map((c) => {
          const inDeck = entries(c);
          const count = inDeck.reduce((n, e) => n + e.quantity, 0);
          const verdict = props.format === "conquest" ? cardLegality(c) : { ok: true, reason: undefined };
          const playable = support?.status(c);
          const img = scry.imageUrl(c, "normal");
          const commander = canCommand(c, props.format);
          const details = () =>
            showCardDetails(c, [
              { label: `+ Add to ${boardLabel(props.defaultBoard).toLowerCase()}`, run: () => props.onAdd(c, props.defaultBoard) },
              ...(commander ? [{ label: "★ Set as commander", run: () => props.onAdd(c, "commander") }] : []),
            ]);
          return (
            <div key={c.id} className={`search-card${count ? " in-deck" : ""}${verdict.ok ? "" : " not-legal"}`}>
              <button className="tile-img" title={`${c.name}: card details`} onClick={details}>
                {img ? <img src={img} alt={c.name} loading="lazy" /> : <span className="noimg">{c.name}</span>}
              </button>
              {!verdict.ok && <span className="legal-badge" title={`Not legal in Conquest: ${verdict.reason}`}>Not legal</span>}
              {playable && !playable.works && (
                <span className={`nw-badge tile-nw${verdict.ok ? "" : " below"}`} title={playable.reason}>{playable.missing ? "Not playable" : "Known issue"}</span>
              )}
              {count > 0 && (
                <span className="in-deck-badge" title={inDeck.map((e) => `${e.quantity} in ${boardLabel(e.board).toLowerCase()}`).join(", ")}>
                  {count} in deck
                </span>
              )}
              <div className="search-card-bar">
                {count > 0 && (
                  <CardMenu
                    label={`Remove ${c.name}`}
                    className="qty-btn"
                    trigger={<span aria-hidden="true">−</span>}
                    sections={[
                      {
                        title: "Remove one from",
                        items: inDeck.map((e) => ({
                          label: `${boardLabel(e.board)} (${e.quantity})`,
                          keepOpen: inDeck.length > 1 || e.quantity > 1,
                          onSelect: () => props.onQty(e, e.quantity - 1),
                        })),
                      },
                    ]}
                  />
                )}
                <button className="btn small add-btn" onClick={() => props.onAdd(c, props.defaultBoard)} title={`Add to ${boardLabel(props.defaultBoard).toLowerCase()}`}>
                  + Add
                </button>
                <CardMenu
                  label={`Add ${c.name} to…`}
                  className="split-btn"
                  trigger={<span aria-hidden="true">▾</span>}
                  sections={[
                    {
                      title: "Add to",
                      items: BOARDS.filter((b) => b.id !== "commander" || commander).map((b) => ({
                        label: b.label,
                        keepOpen: true,
                        onSelect: () => props.onAdd(c, b.id),
                      })),
                    },
                  ]}
                />
                <InfoButton label={`Details for ${c.name}`} onClick={details} />
              </div>
            </div>
          );
        })}
      </div>
      {next && (
        <button className="btn ghost wide" disabled={loadingMore} onClick={() => void more()}>
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}
