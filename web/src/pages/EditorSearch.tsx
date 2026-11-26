// Deck-editor search: a name box with a suggestions dropdown, and a full search results page.
import { useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { MAX_QUANTITY, type Board, type DeckCard } from "../../convex/model/deckRules";
import { showCardDetails } from "../carddetails";
import { plainFits, type IdentityRules } from "../cardsearch";
import { useCardSupport } from "../cardsupport";
import { CardImg } from "../components/CardImg";
import { CardMenu } from "../components/CardMenu";
import { FlipButton, useFlips } from "../components/FlipButton";
import { BusyLabel, CardSkeletons, ScryfallWaiting, Spinner, Waiting } from "../components/Spinner";
import { cardLegality, fitsIdentity, isCommanderEligible } from "../formats/conquest";
import { bestExtraColor, identityQuery, mentionsIdentity, offIdentity } from "../formats/rulebreakers";
import { isPlainList, PACKAGE } from "../deckFormats";
import { commanderCards } from "../edhrec";
import { compileQuery } from "../game/scryquery";
import { localNames, startLocalSearch } from "../localsearch";
import * as scry from "../scryfall";
import { displayTerms, forEdhrecCards, hasOrder, joinQuery, locallyReadable, nameTerms, poolClause, restrictToNames, stripDisplay } from "../searchquery";
import { BOARDS, boardLabel, boardsFor, inDeckParts } from "./boards";

/** The ⓘ button, drawn in CSS (the Unicode glyph renders badly in many fonts). */
export function InfoButton({ label, onClick, className = "" }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button className={`info-btn ${className}`} aria-label={label} title={label} onClick={onClick}>
      <span aria-hidden="true">i</span>
    </button>
  );
}

/** Whether a card can lead a deck of this format. */
export const canCommand = (c: scry.ScryCard, format: string) =>
  format === "conquest" ? isCommanderEligible(c) : /Legendary.*Creature|can be your commander/i.test(`${c.type_line} ${c.oracle_text ?? ""}`);

/**
 * What a Commander or Conquest deck's commanders let it play: a Scryfall clause to add to searches
 * (Rulebreakers included), and a local check for what Scryfall can't express (Conquest's hybrid
 * rule). Null when there's nothing to limit (another format, or no commander yet).
 */
export function identityFilter(format: string, deck: DeckCard[], commanders: scry.ScryCard[], extraColorPick?: string) {
  const conquest = format === "conquest";
  if (!((format === "commander" || conquest) && commanders.length)) return null;
  const fits = conquest ? fitsIdentity : plainFits;
  const extraColor =
    extraColorPick ??
    bestExtraColor(deck.flatMap((d) => { const card = d.board === "main" ? scry.cached(d) : undefined; return card ? [{ card, quantity: d.quantity }] : []; }), commanders, fits);
  /** The ids of `cards` the deck can't play after all (only Conquest's hybrid cards get this far). */
  const offIds = (cards: scry.ScryCard[]) =>
    conquest ? new Set(offIdentity(cards.map((c) => ({ name: c.id, card: c })), commanders, fitsIdentity, extraColor).map((e) => e.name)) : new Set<string>();
  /** The same limits for the local name search, which only needs the commanders' names and colors. */
  const rules: IdentityRules = {
    commanders: commanders.map((c) => ({ name: c.name, layout: c.layout, type_line: c.type_line, color_identity: c.color_identity, legalities: {} })),
    conquest,
    extraColor,
  };
  // Scryfall lets art cards (no colors, not playable) into searches with an identity filter.
  return { clause: `${identityQuery(commanders, extraColor, conquest)} -layout:art_series`, fits, extraColor, offIds, rules };
}

// ---- Name box with suggestions -----------------------------------------------------------

/**
 * Typing shows up to 8 matching card names at once, found in the browser (localsearch.ts); Scryfall is
 * asked when the local list isn't loaded, or doesn't have the name as typed (a card newer than it). Clicking one (or ↓/↑ then Enter) adds that card.
 * Enter on the typed text opens the full results page. With `identity` (a commander deck), only
 * names of cards the commanders allow are suggested.
 */
export function SearchBox(props: { onPick: (name: string) => void; onSubmit: (query: string) => void; autoFocus?: boolean; initial?: string; identity?: IdentityFilter | null }) {
  const [q, setQ] = useState(props.initial ?? "");
  const [names, setNames] = useState<string[]>([]);
  /** Whether `names` are spelling guesses because nothing matched the text as typed. */
  const [guessed, setGuessed] = useState(false);
  /** Looking for names; nothing matches, not even loosely; or Scryfall couldn't be asked. */
  const [state, setState] = useState<"idle" | "searching" | "none" | "failed">("idle");
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
    startLocalSearch();
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
      setState("idle");
      return;
    }
    const identity = props.identity;
    const local = localNames(value, identity?.rules);
    if (!local) {
      askScryfall(value, mine);
      return;
    }
    local.then(
      (r) => {
        if (mine !== seq.current) return;
        if (r.kind === "none" && !r.known) {
          askScryfall(value, mine, "newer");
          return;
        }
        setNames(r.names);
        setGuessed(r.kind === "guess");
        setState(r.names.length ? "idle" : "none");
        setOpen(true);
        // Guesses, so perhaps it's a card newer than our list: see if Scryfall has the name as typed.
        if (r.kind === "guess" && !r.known) askScryfall(value, mine, "quietly");
      },
      () => mine === seq.current && askScryfall(value, mine),
    );
  }

  /**
   * Look the text up on Scryfall once typing pauses. `newer`: our own list has nothing like it, so only
   * names with the text as typed are news. `quietly`: likewise, while our list's guesses are showing.
   */
  function askScryfall(value: string, mine: number, why?: "newer" | "quietly") {
    const identity = props.identity;
    if (why !== "quietly") {
      // Straight away, so it's clear that something's happening; the names of a moment ago stay, dimmed.
      setState("searching");
      setOpen(true);
    }
    timer.current = window.setTimeout(async () => {
      try {
        let found = identity ? await suggestWithin(value, identity) : await scry.autocomplete(value);
        let guess = false;
        if (!found.length && !why && mine === seq.current) {
          // Nothing by that spelling: offer the closest names instead ("did you mean").
          found = await scry.didYouMean(value);
          if (identity && found.length) found = await keepWithin(found, identity);
          guess = true;
        }
        if (mine !== seq.current) return;
        if (why === "quietly") {
          // Only ever added to the end: a name mustn't move as it's being clicked.
          if (found.length) setNames((shown) => [...new Set([...shown, ...found])].slice(0, 8));
          return;
        }
        setNames(found.slice(0, 8));
        setGuessed(guess);
        setState(found.length ? "idle" : "none");
      } catch {
        if (mine !== seq.current || why === "quietly") return;
        setNames([]);
        setState("failed");
      }
    }, why === "quietly" ? 600 : 200);
  }

  function pick(name: string) {
    props.onPick(name);
    setOpen(false);
    setActive(-1);
    setQ("");
    stop();
    setNames([]);
    setGuessed(false);
  }

  /** Forget the lookup that's running: its names aren't wanted any more. */
  function stop() {
    clearTimeout(timer.current);
    seq.current++;
    setState("idle");
  }

  function submit() {
    stop();
    setNames([]);
    setOpen(false);
    props.onSubmit(q.trim());
  }

  function onKey(e: React.KeyboardEvent) {
    // Names that are being replaced can't be picked with the keyboard: Enter is for what's typed now.
    const shown = open && state !== "searching" ? names : [];
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
      else if (q.trim()) submit();
    }
  }

  const listOpen = open && (names.length > 0 || state !== "idle");
  return (
    <div className="suggest" ref={box}>
      <input
        type="search"
        placeholder='Card name, or Scryfall search like "t:dragon c:r". Enter for all results'
        aria-label="Search cards"
        role="combobox"
        aria-expanded={listOpen}
        aria-busy={state === "searching"}
        aria-controls="suggest-list"
        aria-activedescendant={active >= 0 ? `suggest-${active}` : undefined}
        autoComplete="off"
        value={q}
        autoFocus={props.autoFocus}
        onChange={(e) => onInput(e.target.value)}
        className={state === "searching" ? "searching" : undefined}
        onFocus={() => (names.length || state !== "idle") && setOpen(true)}
        onKeyDown={onKey}
      />
      {state === "searching" && <span className="suggest-spin"><Spinner /></span>}
      {/* Said out loud when it changes, for screen readers. */}
      <span className="sr-only" role="status">
        {!open ? "" : state === "searching" ? "Searching" : state === "failed" ? "Couldn't reach Scryfall" : state === "none" ? "No card names match" : names.length ? `${names.length} names` : ""}
      </span>
      {listOpen && (
        <ul className={`suggest-list${state === "searching" && names.length ? " refreshing" : ""}`} id="suggest-list" role="listbox" aria-busy={state === "searching"}>
          {state === "searching" && !names.length && (
            <li className="suggest-note" role="presentation"><ScryfallWaiting text={`Searching for “${q.trim()}”…`} still="Still searching." /></li>
          )}
          {state === "none" && (
            <li className="suggest-note" role="presentation">
              No card names match “{q.trim()}”{props.identity ? " among the cards your commander allows" : ""}, not even a close spelling.
            </li>
          )}
          {state === "failed" && (
            <li className="suggest-note failed" role="presentation">
              Couldn't reach Scryfall.{" "}
              <button type="button" className="text-link" onPointerDown={(e) => e.preventDefault()} onClick={() => onInput(q)}>Try again</button>
            </li>
          )}
          {guessed && names.length > 0 && (
            <li className="suggest-note" role="presentation">
              No card names match “{q.trim()}”{props.identity ? " among the cards your commander allows" : ""}. Did you mean:
            </li>
          )}
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
          <li className="suggest-all" role="option" aria-selected={false} onPointerDown={(e) => e.preventDefault()} onClick={submit}>
            {state === "none" ? "Search Scryfall for" : "See all results for"} “{q.trim()}”{state === "none" ? " anyway" : ""} <kbd>Enter</kbd>
          </li>
        </ul>
      )}
    </div>
  );
}

type IdentityFilter = NonNullable<ReturnType<typeof identityFilter>>;

/**
 * Names matching the typed text among cards the deck's commanders allow. Scryfall's autocomplete
 * can't be filtered, so this is a name search with the identity clause; names starting with the
 * typed text come first, then the rest in Scryfall's (EDHREC popularity) order.
 */
async function suggestWithin(text: string, identity: IdentityFilter): Promise<string[]> {
  const terms = nameTerms(text);
  if (!terms) return [];
  const { cards } = await scry.search(`${terms} ${identity.clause} ${poolClause(text, false)}`);
  const off = identity.offIds(cards);
  const typed = text.trim().toLowerCase();
  const names = [...new Set(cards.filter((c) => !off.has(c.id)).map((c) => c.name))];
  return [...names.filter((n) => n.toLowerCase().startsWith(typed)), ...names.filter((n) => !n.toLowerCase().startsWith(typed))];
}

/** Those of `names` (exact card names) the deck's commanders allow, in the same order. */
async function keepWithin(names: string[], identity: IdentityFilter): Promise<string[]> {
  const exact = names.map((n) => `!"${n.replace(/"/g, "")}"`).join(" or ");
  const { cards } = await scry.search(`(${exact}) ${identity.clause} ${poolClause("", false)}`);
  const off = identity.offIds(cards);
  const ok = new Set(cards.filter((c) => !off.has(c.id)).map((c) => c.name));
  return names.filter((n) => ok.has(n));
}

// ---- Full results page -----------------------------------------------------------------

/** Which of a card's deck entries the − button takes one from: the add-to board first, the commander last. */
function removeFrom(entries: DeckCard[], preferred: Board): DeckCard {
  const order: Board[] = [preferred, "main", "side", "maybe", "commander"];
  return [...entries].sort((a, z) => order.indexOf(a.board) - order.indexOf(z.board))[0];
}

/** Cards per page of Scryfall search results. */
const SCRYFALL_PAGE = 175;

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
  onAdd: (c: scry.ScryCard, b: Board, exact: boolean, copies?: number) => void;
  onQty: (entry: DeckCard, q: number) => void;
  /** Takes one copy of this entry out of the deck. */
  onRemoveOne: (entry: DeckCard) => void;
  onSearch: (q: string) => void;
  onPickName: (name: string) => void;
  onClose: () => void;
}) {
  const [cards, setCards] = useState<scry.ScryCard[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [next, setNext] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const support = useCardSupport();
  const flips = useFlips();
  const [allColors, setAllColors] = useState(false);
  /** Show digital-only cards (Alchemy, Arena, MTGO) and Un-cards too (hidden by default). */
  const [withOdd, setWithOdd] = useState(false);
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
  const identity = identityFilter(props.format, props.deck, props.commanders, props.extraColor);
  const canFilter = !!identity && !mentionsIdentity(props.query);
  const filtered = canFilter && !allColors;
  const fits = identity?.fits ?? ((card: { color_identity: string[] }, id: Set<string>) => card.color_identity.every((x) => id.has(x)));
  const extraColor = identity?.extraColor;
  const idClause = filtered ? identity.clause : "";
  const additionsOn = !!additions.trim() && !skipAdditions;
  const added = additionsOn ? additions : "";
  // Never tokens; digital-only printings and Un-cards only when asked for.
  const pool = poolClause(`${props.query} ${added}`, withOdd);
  // Display keywords (order:, unique:) go last and outside the parentheses.
  const fullQuery = [joinQuery(props.query, idClause, stripDisplay(added), pool), displayTerms(added)].filter(Boolean).join(" ");
  const queryWithout = joinQuery(props.query, idClause, poolClause(props.query, withOdd));
  // A search for printings (unique:prints, set:, prefer:, ...) shows the printing you want; add that one.
  const exact = PRINTING_QUERY.test(fullQuery);
  const additionsFilter = additionsOn && !!stripDisplay(additions).trim();
  // Conquest's hybrid rule has no Scryfall syntax: hybrid cards come back and are checked here.
  const off = filtered && conquest ? identity.offIds(cards) : null;

  // Most played with the commander first (EDHREC). By default only for searches we can check
  // against that list locally (and without their own order:); the button ranks any search, asking
  // Scryfall which of the list's cards match when we can't tell locally.
  const commanderNames = props.commanders.map((c) => scry.deckName(c)).join(" and ");
  const localQuery = joinQuery(forEdhrecCards(props.query), forEdhrecCards(added));
  const readable = locallyReadable(localQuery);
  const commanderDeck = !!identity;
  const rankOn = commanderDeck && (rankChoice ?? (readable && !hasOrder(fullQuery)));
  const filterQuery = joinQuery(props.query, idClause, stripDisplay(added), pool);
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
          return card && pred(card) && !scry.isTokenLike(card) ? [{ card, inclusion: e.inclusion }] : [];
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
        if (filtered && conquest && identity) found = found.filter((f) => !identity.offIds([f.card]).has(f.card.id));
      }
      if (live) (setRanked(found), setRankStatus(found.length ? "" : `None of the cards EDHREC lists for ${commanderNames} match this search.`));
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankOn, readable, localQuery, filterQuery, commanderKey, filtered, extraColor, conquest]);

  const rankedNames = new Set(ranked.map((r) => scry.deckName(r.card)));
  const shown = cards.filter((c) => !off?.has(c.id) && !rankedNames.has(scry.deckName(c)) && !scry.isTokenLike(c));

  useEffect(() => {
    if (settings === undefined) return; // wait for the additions
    let live = true;
    setCards([]);
    setTotal(null);
    setError("");
    scry.search(fullQuery).then(
      (p) => live && (setCards(p.cards), setTotal(p.total), setNext(p.nextPage)),
      (e) => live && setError(scry.lookupError(e)),
    );
    return () => {
      live = false;
    };
  }, [fullQuery, settings === undefined, attempt]);

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
      if (e.key === "Escape" && !document.querySelector("dialog[open], .card-menu, .deck-drawer.open")) props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  async function more() {
    if (!next) return;
    setLoadingMore(true);
    setError("");
    try {
      const p = await scry.nextPage(next);
      setCards((c) => [...c, ...p.cards]);
      setNext(p.nextPage);
    } catch (e) {
      setError(scry.lookupError(e));
    } finally {
      setLoadingMore(false);
    }
  }

  /** This card's entries in the deck (one per board it's on). */
  const entries = (c: scry.ScryCard) => {
    const name = scry.deckName(c).toLowerCase();
    return props.deck.filter((d) => d.name.toLowerCase() === name);
  };

  const commanderFormat = props.format === "commander" || conquest;

  const tile = (c: scry.ScryCard, inclusion?: number) => {
    const inDeck = entries(c);
    const count = inDeck.reduce((n, e) => n + e.quantity, 0);
    const verdict = props.format === "conquest" ? cardLegality(c) : { ok: true, reason: undefined };
    const playable = support?.status(c);
    const face = flips.face(c);
    const img = scry.imageUrl(c, "normal", face);
    const commander = !isPlainList(props.format) && canCommand(c, props.format);
    const details = () =>
      showCardDetails(c, [
        { label: `+ Add to ${boardLabel(props.defaultBoard, props.format).toLowerCase()}`, run: () => props.onAdd(c, props.defaultBoard, exact) },
        ...(commander ? [{ label: "★ Set as commander", run: () => props.onAdd(c, "commander", exact) }] : []),
      ]);
    return (
      <div key={c.id} className={`search-card${count ? ` in-deck in-${inDeckParts(inDeck, props.format)[0].board}` : ""}${verdict.ok ? "" : " not-legal"}${playable && !playable.works ? (playable.missing ? " not-playable" : " known-issue") : ""}`}>
        <button className="tile-img" title={`${c.name}: card details`} onClick={details}>
          {img ? <CardImg src={img} name={c.name} alt={c.name} loading="lazy" /> : <span className="noimg">{c.name}</span>}
        </button>
        <FlipButton card={c} face={face} onFlip={flips.toggle} />
        {!verdict.ok && <span className="legal-badge" title={`Not legal in Conquest: ${verdict.reason}`}>Not legal</span>}
        {playable && !playable.works && (
          <span className={`nw-badge tile-nw${playable.missing ? " missing" : ""}`} title={playable.reason}>{playable.missing ? "Not playable" : "Known issue"}</span>
        )}
        {props.format === "commander" && c.game_changer && (
          <span className="gc-badge tile-gc" title="Game Changer: Exhibition and Core decks allow none, Upgraded up to 3">GC</span>
        )}
        {count > 0 && (
          <span className="in-deck-badge" title={inDeck.map((e) => `${e.quantity} in ${boardLabel(e.board, props.format).toLowerCase()}`).join(", ")}>
            {inDeckParts(inDeck, props.format).map((p, i) => (
              <span key={p.board} className={`board-${p.board}`}>{i > 0 && <span className="sep"> · </span>}{p.text}</span>
            ))}
          </span>
        )}
        {inclusion !== undefined && (
          <span className="edh-share muted small" title={`EDHREC: in ${Math.round(inclusion * 100)}% of decks with ${commanderNames}`}>
            In {Math.round(inclusion * 100)}% of decks
          </span>
        )}
        <div className="search-card-bar">
          {count > 0 && commanderFormat ? (
            // Commander decks: the card is (nearly always) in one place, so − just takes one out:
            // from the board new cards go to if it's there, else the main deck, sideboard, considering, commander.
            <button className="menu-btn qty-btn" aria-label={`Remove one ${c.name}`} title={`Remove one ${c.name}`} onClick={() => props.onRemoveOne(removeFrom(inDeck, props.defaultBoard))}>
              <span aria-hidden="true">−</span>
            </button>
          ) : count > 0 && (
            <CardMenu
              label={`Remove ${c.name}`}
              className="qty-btn"
              trigger={<span aria-hidden="true">−</span>}
              sections={[
                {
                  title: "Remove one from",
                  items: inDeck.map((e) => ({
                    label: `${boardLabel(e.board, props.format)} (${e.quantity})`,
                    keepOpen: inDeck.length > 1 || e.quantity > 1,
                    onSelect: () => props.onQty(e, e.quantity - 1),
                  })),
                },
              ]}
            />
          )}
          <button className="btn small add-btn" onClick={() => props.onAdd(c, props.defaultBoard, exact)} title={`Add to ${boardLabel(props.defaultBoard, props.format).toLowerCase()}`}>
            + Add
          </button>
          <CardMenu
            label={`Add ${c.name} to…`}
            className="split-btn"
            trigger={<span aria-hidden="true">▾</span>}
            sections={[
              {
                title: "Add to",
                items: boardsFor(props.format).filter((b) => b.id !== "commander" || commander).map((b) => ({
                  label: b.label,
                  keepOpen: true,
                  onSelect: () => props.onAdd(c, b.id, exact),
                })),
              },
              {
                items: [
                  {
                    label: `Add to ${boardLabel(props.defaultBoard, props.format).toLowerCase()}`,
                    onSelect: () => {},
                    amount: { initial: 2, min: 1, max: MAX_QUANTITY, button: "Add", onAmount: (n) => props.onAdd(c, props.defaultBoard, exact, n) },
                  },
                ],
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
        <button className="btn back-to-deck" onClick={props.onClose}>← Back to {props.format === PACKAGE ? "package" : isPlainList(props.format) ? "list" : "deck"}</button>
        <div className="search-page-box">
          <SearchBox key={props.query} initial={props.query} onSubmit={props.onSearch} onPick={props.onPickName} />
        </div>
        {boardsFor(props.format).length > 1 && <label className="inline small muted">
          + Add goes to{" "}
          <select value={props.defaultBoard} onChange={(e) => props.onDefaultBoard(e.target.value as Board)}>
            {BOARDS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </label>}
      </div>
      <p className="muted small search-status">
        {error ? (
          <span className="form-error">{error} <button className="text-link" onClick={() => (cards.length ? void more() : setAttempt((n) => n + 1))}>Try again</button></span>
        ) : total === null ? (
          <ScryfallWaiting text={`Searching for “${props.query}”…`} still="Still searching." className="" />
        ) : total ? (
          <span className="search-count">
            <strong>{total.toLocaleString()} card{total === 1 ? "" : "s"}</strong> for “{props.query}”
            {total > cards.length && <> · showing {cards.length.toLocaleString()}</>}
          </span>
        ) : (
          `No cards found for “${props.query}”.`
        )}
        {canFilter && (
          <label className="inline">
            {" "}
            <input type="checkbox" checked={!allColors} onChange={(e) => setAllColors(!e.target.checked)} /> Only cards your commander allows
          </label>
        )}
        <label className="inline" title="Digital-only: Alchemy, Arena and MTGO cards and printings. Un-cards: silver-bordered and acorn joke cards. Neither is legal in paper Commander. When this is off, a card shows its paper printing.">
          {" "}
          <input type="checkbox" checked={withOdd} onChange={(e) => setWithOdd(e.target.checked)} /> Include digital-only (Alchemy) and Un-cards
        </label>
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
      {rankOn && rankStatus && <p className="muted small">{rankStatus.endsWith("…") ? <Waiting text={rankStatus} slow={`${rankStatus} (taking a while)`} /> : rankStatus}</p>}
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
      <div className="search-grid">
        {shown.map((c) => tile(c))}
        {loadingMore && <CardSkeletons n={Math.min(6, (total ?? 0) - cards.length)} />}
      </div>
      {total === null && !error && <div className="loading" aria-hidden="true"><div className="spinner" /></div>}
      {next && (
        <button className="btn ghost wide" disabled={loadingMore} onClick={() => void more()}>
          <BusyLabel busy={loadingMore} working="Loading…">
            {total !== null && total > cards.length
              ? `Load ${Math.min(SCRYFALL_PAGE, total - cards.length).toLocaleString()} more (${(total - cards.length).toLocaleString()} left)`
              : "Load more"}
          </BusyLabel>
        </button>
      )}
    </section>
  );
}
