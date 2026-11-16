// Deck-editor search: a name box with a suggestions dropdown, and a full search results page.
import { useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Board, DeckCard } from "../../convex/model/deckRules";
import { errorMessage } from "../app/errors";
import { showCardDetails } from "../carddetails";
import { useCardSupport } from "../cardsupport";
import { CardMenu } from "../components/CardMenu";
import { cardLegality, fitsIdentity, isCommanderEligible } from "../formats/conquest";
import { bestExtraColor, identityQuery, mentionsIdentity, offIdentity } from "../formats/rulebreakers";
import { commanderCards } from "../edhrec";
import { compileQuery } from "../game/scryquery";
import * as scry from "../scryfall";
import { displayTerms, forEdhrecCards, hasOrder, joinQuery, locallyReadable, restrictToNames, stripDisplay } from "../searchquery";
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

const normName = (n: string) => n.split(" // ")[0].replace(/[‘’]/g, "'").toLowerCase();

/** Query terms that choose printings rather than cards. */
const PRINTING_QUERY = /(^|[\s(])-?(unique:(prints|art)|prefer:|s:|set:|e:|edition:|cn:|number:|is:(promo|showcase|borderless|extendedart|fullart|etched|reprint|firstprint))/i;

export function SearchResults(props: {
  query: string;
  format: string;
  deck: DeckCard[];
  /** The deck's commanders (Scryfall data), to limit results to cards the deck can use. */
  commanders: scry.ScryCard[];
  /** The deck's pick for a commander like Tolabow. */
  extraColor?: string;
  defaultBoard: Board;
  onDefaultBoard: (b: Board) => void;
  /** `exact`: the search shows specific printings, so add that one instead of the default printing. */
  onAdd: (c: scry.ScryCard, b: Board, exact: boolean) => void;
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
  const [allColors, setAllColors] = useState(false);
  /** The player's pick for ranking by the commander's EDHREC list; null = the default. Kept across searches. */
  const [rankChoice, setRankChoice] = useState<boolean | null>(null);
  const [rankStatus, setRankStatus] = useState("");
  // The player's saved additions, which they can turn off for one search.
  const settings = useQuery(api.settings.get);
  const additions = settings?.searchAdditions ?? "";
  const [skipAdditions, setSkipAdditions] = useState(false);
  const [withoutTotal, setWithoutTotal] = useState<number | null>(null);
  const [ranked, setRanked] = useState<{ card: scry.ScryCard; inclusion: number }[]>([]);
  useEffect(() => setSkipAdditions(false), [props.query]);

  // In a Commander or Conquest deck, only cards the commanders allow, Rulebreakers included,
  // unless the query already filters by color identity or the player asks for every color.
  const conquest = props.format === "conquest";
  const commanderDeck = (props.format === "commander" || conquest) && props.commanders.length > 0;
  const canFilter = commanderDeck && !mentionsIdentity(props.query);
  const filtered = canFilter && !allColors;
  const fits = conquest ? fitsIdentity : (card: { color_identity: string[] }, id: Set<string>) => card.color_identity.every((x) => id.has(x));
  const extraColor =
    props.extraColor ??
    bestExtraColor(props.deck.flatMap((d) => { const card = d.board === "main" ? scry.cached(d) : undefined; return card ? [{ card, quantity: d.quantity }] : []; }), props.commanders, fits);
  const idClause = filtered ? identityQuery(props.commanders, extraColor, conquest) : "";
  const additionsOn = !!additions.trim() && !skipAdditions;
  const added = additionsOn ? additions : "";
  // Display keywords (order:, unique:) go last and outside the parentheses.
  const fullQuery = [joinQuery(props.query, idClause, stripDisplay(added)), displayTerms(added)].filter(Boolean).join(" ");
  const queryWithout = joinQuery(props.query, idClause);
  // A search for printings (unique:prints, set:, prefer:, ...) shows the printing you want; add that one.
  const exact = PRINTING_QUERY.test(fullQuery);
  const additionsFilter = additionsOn && !!stripDisplay(additions).trim();
  // Conquest's hybrid rule has no Scryfall syntax: hybrid cards come back and are checked here.
  const offIds = (cs: scry.ScryCard[]) => new Set(offIdentity(cs.map((c) => ({ name: c.id, card: c })), props.commanders, fitsIdentity, extraColor).map((e) => e.name));
  const off = filtered && conquest ? offIds(cards) : null;

  // Most played with the commander first (EDHREC). By default only for searches we can check
  // against that list locally (and without their own order:); the button ranks any search, asking
  // Scryfall which of the list's cards match when we can't tell locally.
  const commanderNames = props.commanders.map((c) => scry.deckName(c)).join(" and ");
  const localQuery = joinQuery(forEdhrecCards(props.query), forEdhrecCards(added));
  const readable = locallyReadable(localQuery);
  const rankOn = commanderDeck && (rankChoice ?? (readable && !hasOrder(fullQuery)));
  const filterQuery = joinQuery(props.query, idClause, stripDisplay(added));
  const commanderKey = props.commanders.map((c) => c.name).join("|");

  useEffect(() => {
    setRanked([]);
    setRankStatus("");
    if (!rankOn) return;
    let live = true;
    const pred = readable ? compileQuery(localQuery) : null;
    void (async () => {
      setRankStatus("Loading EDHREC's list…");
      const list = await commanderCards(props.commanders.map((c) => scry.deckName(c)));
      if (!live) return;
      if (!list.length) return setRankStatus(`EDHREC has no list for ${commanderNames}.`);
      let found: { card: scry.ScryCard; inclusion: number }[];
      if (typeof pred === "function") {
        await scry.cardsById(list.map((e) => e.id)).catch(() => undefined);
        found = list.flatMap((e) => {
          const card = scry.cachedById(e.id);
          return card && pred(card) ? [{ card, inclusion: e.inclusion }] : [];
        });
        if (filtered) {
          const outside = new Set(offIdentity(found.map((f) => ({ name: f.card.id, card: f.card })), props.commanders, fits, extraColor).map((e) => e.name));
          found = found.filter((f) => !outside.has(f.card.id));
        }
      } else {
        // Scryfall checks the list against the whole search, ~40 names per request.
        const matched = new Map<string, scry.ScryCard>();
        const chunks = restrictToNames(filterQuery, list.map((e) => e.name));
        for (let i = 0; i < chunks.length; i++) {
          if (!live) return;
          setRankStatus(`Checking EDHREC's list against your search (${i + 1} of ${chunks.length})…`);
          const page = await scry.search(chunks[i]).catch(() => null);
          for (const c of page?.cards ?? []) matched.set(normName(scry.deckName(c)), c);
        }
        found = list.flatMap((e) => {
          const card = matched.get(normName(e.name));
          return card ? [{ card, inclusion: e.inclusion }] : [];
        });
        if (filtered && conquest) found = found.filter((f) => !offIds([f.card]).has(f.card.id));
      }
      if (live) (setRanked(found), setRankStatus(found.length ? "" : `None of the cards EDHREC lists for ${commanderNames} match this search.`));
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankOn, readable, localQuery, filterQuery, commanderKey, filtered, extraColor, conquest]);

  const rankedNames = new Set(ranked.map((r) => scry.deckName(r.card)));
  const shown = cards.filter((c) => !off?.has(c.id) && !rankedNames.has(scry.deckName(c)));

  useEffect(() => {
    if (settings === undefined) return; // wait for the additions
    let live = true;
    setCards([]);
    setTotal(null);
    setError("");
    scry.search(fullQuery).then(
      (p) => live && (setCards(p.cards), setTotal(p.total), setNext(p.nextPage)),
      (e) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, [fullQuery, settings === undefined]);

  // How many cards the additions hid: the same search without them.
  useEffect(() => {
    setWithoutTotal(null);
    if (!additionsFilter) return;
    let live = true;
    scry.search(queryWithout).then(
      (p) => live && setWithoutTotal(p.total),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [queryWithout, additionsFilter]);
  const hidden = additionsFilter && total !== null && withoutTotal !== null ? withoutTotal - total : 0;

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

  const tile = (c: scry.ScryCard, inclusion?: number) => {
    const inDeck = entries(c);
    const count = inDeck.reduce((n, e) => n + e.quantity, 0);
    const verdict = props.format === "conquest" ? cardLegality(c) : { ok: true, reason: undefined };
    const playable = support?.status(c);
    const img = scry.imageUrl(c, "normal");
    const commander = canCommand(c, props.format);
    const details = () =>
      showCardDetails(c, [
        { label: `+ Add to ${boardLabel(props.defaultBoard).toLowerCase()}`, run: () => props.onAdd(c, props.defaultBoard, exact) },
        ...(commander ? [{ label: "★ Set as commander", run: () => props.onAdd(c, "commander", exact) }] : []),
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
        {inclusion !== undefined && (
          <span className="edh-share muted small" title={`EDHREC: in ${Math.round(inclusion * 100)}% of decks with ${commanderNames}`}>
            In {Math.round(inclusion * 100)}% of decks
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
          <button className="btn small add-btn" onClick={() => props.onAdd(c, props.defaultBoard, exact)} title={`Add to ${boardLabel(props.defaultBoard).toLowerCase()}`}>
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
                  onSelect: () => props.onAdd(c, b.id, exact),
                })),
              },
            ]}
          />
          <InfoButton label={`Details for ${c.name}`} onClick={details} />
        </div>
      </div>
    );
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
        {canFilter && (
          <label className="inline">
            {" "}
            <input type="checkbox" checked={!allColors} onChange={(e) => setAllColors(!e.target.checked)} /> Only cards your commander allows
          </label>
        )}
        {commanderDeck && (
          <>
            {" "}
            <button
              className={`btn small ${rankOn ? "" : "ghost"}`}
              aria-pressed={rankOn}
              title={rankOn ? "Show this search in its normal order" : `Put the cards EDHREC says ${commanderNames} decks play most first`}
              onClick={() => setRankChoice(!rankOn)}
            >
              {rankOn ? `Ranked for ${commanderNames} ✕` : `Rank by EDHREC for ${commanderNames}`}
            </button>
          </>
        )}
      </p>
      {rankOn && rankStatus && <p className="muted small">{rankStatus}</p>}
      {additionsOn && hidden > 0 && (
        <p className="small search-notice">
          Your search additions (<code>{additions}</code>) hid {hidden.toLocaleString()} card{hidden === 1 ? "" : "s"}.{" "}
          <button className="text-link" onClick={() => setSkipAdditions(true)}>Search without them</button>
        </p>
      )}
      {skipAdditions && (
        <p className="small search-notice">
          Search additions (<code>{additions}</code>) are off for this search.{" "}
          <button className="text-link" onClick={() => setSkipAdditions(false)}>Turn them back on</button>
        </p>
      )}
      {ranked.length > 0 && (
        <>
          <h3 className="search-section">Most played with {commanderNames}</h3>
          <div className="search-grid">{ranked.map((r) => tile(r.card, r.inclusion))}</div>
          {shown.length > 0 && <h3 className="search-section">More cards</h3>}
        </>
      )}
      <div className="search-grid">{shown.map((c) => tile(c))}</div>
      {next && (
        <button className="btn ghost wide" disabled={loadingMore} onClick={() => void more()}>
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}
