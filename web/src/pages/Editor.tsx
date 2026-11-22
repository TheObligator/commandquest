import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_CARD_TAG_LENGTH, MAX_CARD_TAGS, MAX_QUANTITY, cleanCardTags, type Board, type DeckCard } from "../../convex/model/deckRules";
import { errorMessage } from "../app/errors";
import { navigate, replaceQuietly, useLeaveGuard, useRoute } from "../app/router";
import { closeOnBackdrop, showCardDetails } from "../carddetails";
import { useCardSupport, type CardSupport } from "../cardsupport";
import { mergeDuplicates, parseDecklist, writeDecklist, type ParsedToken } from "../decklist";
import { toast } from "../dom";
import { CardMenu, type MenuItem, type MenuSection } from "../components/CardMenu";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu";
import { ColorStats } from "../components/ColorStats";
import { DeckBracket } from "../components/DeckBracket";
import { deckAverages, playableLandBack } from "../deckstats";
import { FORMATS } from "../deckFormats";
import { DeckTokens } from "../components/DeckTokens";
import { FlipButton, useFlips } from "../components/FlipButton";
import { CardViewToggle, useCardView, useStackColumns } from "../cardView";
import { ManaCurve } from "../components/ManaCurve";
import { columnsOf, packStacks, stackColClass } from "../stackLayout";
import { GROUPINGS, deckTags, groupCards, saveGroupBy, savedGroupBy, type CardGroup, type GroupBy } from "../deckGroups";
import { ManaCost } from "../components/ManaCost";
import { Loading } from "../components/Spinner";
import { CONQUEST } from "../formats/conquest";
import { checkDeck, identityTest } from "../deckcheck";
import { canPair, partnerQuery, partnerSlotLabel } from "../formats/partners";
import { bestExtraColor, extraColorChoice, noMaxDeckSize } from "../formats/rulebreakers";
import { PRINTING_PREFS, prefLabel, type PrintingPref } from "../printings";
import * as scry from "../scryfall";
import { tokenPicks } from "../tokens";
import { useCardPreview } from "../useCardPreview";
import { printingPref, usePrintingPref } from "../usePrintingPref";
import { BOARDS } from "./boards";
import { canCommand, identityFilter, SearchBox, SearchResults } from "./EditorSearch";
import { capitalize } from "./DeckList";

/** Up to this many main-deck planeswalkers are shown beside the commander(s). */
const MAX_WALKERS_BESIDE_COMMANDER = 3;

const COLORS: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const UNTITLED = "Untitled deck";
/** A card name compared without case or its back face ("Delver of Secrets // Insectile Aberration"). */
const front = (name: string) => name.split(" // ")[0].toLowerCase();

type TokenPick = { identity: string; scryfallId: string };

interface Draft {
  id?: Id<"decks">;
  name: string;
  format: string;
  cards: DeckCard[];
  /** The color a Rulebreaker commander like Tolabow lets this deck add. */
  extraColor?: string;
  /** The Commander bracket the player gives the deck, and their reasons (src/brackets.ts). */
  bracket?: number;
  bracketTags?: string[];
}

/** The editor's URL: the deck (or a new one) and the search open in it, if any. */
function editorPath(id: Id<"decks"> | undefined, search: string | null) {
  return `/decks/${id ?? "new"}${search ? `?${new URLSearchParams({ q: search })}` : ""}`;
}

/** Loads the deck (if editing one), then hands it to the editor once. */
export function Editor({ id }: { id?: string }) {
  const saved = useQuery(api.decks.get, id ? { id } : "skip");
  if (id && saved === undefined) return <Loading />;
  if (id && saved === null) {
    return (
      <>
        <p className="form-error">Deck not found.</p>
        <a href="#/decks" className="link">← Back to decks</a>
      </>
    );
  }
  const initial: Draft = saved ? { id: saved._id, name: saved.name, format: saved.format, cards: saved.cards, extraColor: saved.extraColor, bracket: saved.bracket, bracketTags: saved.bracketTags } : { name: UNTITLED, format: "commander", cards: [] };
  return <DeckEditor initial={initial} />;
}

function DeckEditor({ initial }: { initial: Draft }) {
  const { query } = useRoute();
  const [deck, setDeck] = useState<Draft>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedOnce, setSavedOnce] = useState(!!initial.id);
  const [missing, setMissing] = useState<string[]>([]);
  // A deck whose cards aren't cached waits on Scryfall (a second or more): show a loading screen
  // until they're in rather than a list that fills in piece by piece.
  const [loadingCards, setLoadingCards] = useState(() => initial.cards.some((c) => !scry.cachedExact(c) && !scry.cached(c)));
  const [, setCardData] = useState(0); // bumped when Scryfall data arrives, to re-render
  const [tab, setTab] = useState<"search" | "import">(query.has("import") ? "import" : "search");
  // The open search is in the URL (#/decks/<id>?q=…), so a reload or a shared link reopens it.
  const [searchQuery, setSearchQuery] = useState<string | null>(() => query.get("q") || null);
  const searchRef = useRef(searchQuery);
  /** The deck drawer at the bottom of the search results: open or just its bar. */
  const [deckOpen, setDeckOpen] = useState(false);
  searchRef.current = searchQuery;
  const [addTo, setAddTo] = useState<Board>("main");
  const pref = usePrintingPref();
  const [repicking, setRepicking] = useState(false);

  const createDeck = useMutation(api.decks.create);
  const updateDeck = useMutation(api.decks.update);
  const removeDeck = useMutation(api.decks.remove);
  const importFromUrl = useAction(api.importDeck.fromUrl);
  const addTokenArt = useMutation(api.decks.addTokenArt);
  // Token art from an import into a deck that isn't saved yet: stored once it's created.
  const pendingTokenArt = useRef<TokenPick[]>([]);

  // ---- Autosave ----
  // Every change bumps `version` and marks the deck dirty; a save runs ~0.8 s after the last change.
  // Saves never overlap: a change during a save queues one more save, so a new deck is only ever
  // created once. Leaving the page saves pending changes right away.
  const deckRef = useRef(deck);
  deckRef.current = deck;
  const version = useRef(0);
  const idRef = useRef<Id<"decks"> | undefined>(initial.id);
  const inFlight = useRef(false);
  const again = useRef(false);
  const deleted = useRef(false);

  const firstSearch = useRef(true);
  useEffect(() => {
    if (firstSearch.current) return void (firstSearch.current = false); // the URL already says it
    if (deleted.current) return;
    replaceQuietly(editorPath(idRef.current, searchQuery));
  }, [searchQuery]);

  const markChanged = () => {
    version.current++;
    setDirty(true);
  };

  const change = (fn: (d: Draft) => Draft) => {
    setDeck((d) => fn({ ...d, cards: d.cards.map((c) => ({ ...c })) }));
    markChanged();
  };

  // ---- Scryfall data for the deck's cards ----
  const resolveCards = useCallback(async (cards: DeckCard[]) => {
    let notFound: string[];
    try {
      notFound = await scry.resolve(cards);
    } catch (e) {
      toast(`Couldn't load card data from Scryfall: ${errorMessage(e)}`, "error");
      return;
    }
    setMissing(notFound);
    setCardData((n) => n + 1);
    // Use Forge's names ("Delver of Secrets", not "Delver of Secrets // Insectile Aberration")
    // and fill in printings for cards that don't have one (or have a token's).
    setDeck((d) => {
      let changed = false;
      const next = d.cards.map((c) => {
        const s = scry.cachedExact(c) ?? scry.cached(c);
        if (!s) return c;
        const out = { ...c };
        if (out.name !== scry.deckName(s)) (out.name = scry.deckName(s)), (changed = true);
        // No printing yet, or a token's printing (Angel of Sanctions' token) where the card should be.
        if (!out.scryfallId || scry.printingIsToken(c)) {
          out.scryfallId = s.id;
          out.set = s.set;
          out.collectorNumber = s.collector_number;
          changed = true;
        }
        return out;
      });
      if (!changed) return d;
      markChanged();
      return { ...d, cards: mergeDuplicates(next) };
    });
  }, []);

  useEffect(() => {
    void resolveCards(initial.cards).finally(() => setLoadingCards(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Deck changes ----
  /** Adds one copy. A new card gets your default printing unless `exact` (you picked this printing). */
  async function addCard(c: scry.ScryCard, board: Board, exact = false, copies = 1) {
    const name = scry.deckName(c);
    const p = printingPref();
    const inBoard = deckRef.current.cards.some((x) => x.board === board && x.name.toLowerCase() === name.toLowerCase());
    let print = c;
    if (!exact && !inBoard && p !== "default") {
      try {
        print = (await scry.preferredPrintings([name], p)).get(name.toLowerCase()) ?? c;
      } catch {
        // Scryfall busy: add the printing that was shown.
      }
    }
    change((d) => {
      const existing = d.cards.find((x) => x.board === board && x.name.toLowerCase() === name.toLowerCase());
      if (existing) existing.quantity = Math.min(MAX_QUANTITY, existing.quantity + copies);
      else d.cards.push({ name, quantity: Math.min(MAX_QUANTITY, copies), board, scryfallId: print.id, set: print.set, collectorNumber: print.collector_number });
      return d;
    });
    toast(`Added ${copies > 1 ? `${copies} × ` : ""}${name}${board === "main" ? "" : " to " + BOARDS.find((b) => b.id === board)!.label.toLowerCase()}`);
  }

  /**
   * Gives the deck entries `match` picks the printing `p` chooses. Returns how many changed, or
   * null when Scryfall couldn't be reached.
   */
  async function repick(match: (c: DeckCard) => boolean, p: PrintingPref): Promise<number | null> {
    const names = [...new Set(deckRef.current.cards.filter(match).map((c) => c.name))];
    if (!names.length) return 0;
    let picks: Map<string, scry.ScryCard>;
    try {
      picks = await scry.preferredPrintings(names, p);
    } catch (e) {
      toast(`Couldn't look up printings on Scryfall: ${errorMessage(e)}`, "error");
      return null;
    }
    const pickFor = (c: DeckCard) => picks.get(c.name.toLowerCase()) ?? picks.get(front(c.name));
    const changed = deckRef.current.cards.filter((c) => match(c) && pickFor(c) && pickFor(c)!.id !== c.scryfallId).length;
    if (!changed) return 0;
    change((d) => {
      for (const c of d.cards) {
        const pick = match(c) ? pickFor(c) : undefined;
        if (pick) Object.assign(c, { scryfallId: pick.id, set: pick.set, collectorNumber: pick.collector_number });
      }
      return { ...d, cards: mergeDuplicates(d.cards) };
    });
    setCardData((n) => n + 1);
    return changed;
  }

  /** Deck menu: every card to the printing `p` chooses. */
  async function setAllPrintings(p: PrintingPref) {
    const label = prefLabel(p);
    if (!confirm(`Change every card in "${deck.name}" to: ${label}?\n\nPrintings you picked yourself are replaced.`)) return;
    setRepicking(true);
    toast(`Finding printings (${label.toLowerCase()})…`);
    try {
      const n = await repick(() => true, p);
      if (n !== null) toast(n ? `Changed ${n} printing${n === 1 ? "" : "s"} to: ${label}` : `Every card already has that printing`);
    } finally {
      setRepicking(false);
    }
  }

  async function addByName(name: string) {
    try {
      await addCard(await scry.named(name), addTo);
    } catch (e) {
      toast(`Couldn't find ${name}: ${errorMessage(e)}`, "error");
    }
  }

  // Entries are found by board and name, not by object: every change copies the cards, so an entry
  // from an earlier render (two quick clicks) would otherwise not be found.
  const entryIndex = (cards: DeckCard[], target: DeckCard) => cards.findIndex((c) => c.board === target.board && c.name === target.name);

  function setQty(target: DeckCard, q: number) {
    change((d) => {
      const i = entryIndex(d.cards, target);
      if (i < 0) return d;
      if (q <= 0) d.cards.splice(i, 1);
      else d.cards[i].quantity = Math.min(q, MAX_QUANTITY);
      return d;
    });
  }

  /** Takes one copy out of the deck (each click counts, however quick). */
  function removeOne(target: DeckCard) {
    change((d) => {
      const i = entryIndex(d.cards, target);
      if (i < 0) return d;
      if (d.cards[i].quantity <= 1) d.cards.splice(i, 1);
      else d.cards[i].quantity--;
      return d;
    });
    toast(`Removed ${target.name}${target.board === "main" ? "" : " from " + BOARDS.find((b) => b.id === target.board)!.label.toLowerCase()}`);
  }

  function setTags(target: DeckCard, tags: string[]) {
    change((d) => {
      const i = entryIndex(d.cards, target);
      if (i < 0) return d;
      const clean = cleanCardTags(tags);
      if (clean.length) d.cards[i].tags = clean;
      else delete d.cards[i].tags;
      return d;
    });
  }

  function moveCard(target: DeckCard, board: Board) {
    const i = deck.cards.indexOf(target);
    change((d) => {
      d.cards[i].board = board;
      return { ...d, cards: mergeDuplicates(d.cards) };
    });
  }

  /**
   * Makes one copy of `target` a commander. Alone, it replaces the deck's commander(s), who go to
   * the main deck; as a partner it joins the one already there.
   */
  function makeCommander(target: DeckCard, partner: boolean) {
    const i = deck.cards.indexOf(target);
    const replaced = partner ? [] : deck.cards.filter((c) => c.board === "commander").map((c) => c.name);
    change((d) => {
      if (!partner) for (const c of d.cards) if (c.board === "commander") c.board = "main";
      const t = d.cards[i];
      if (t.quantity > 1) {
        t.quantity--;
        d.cards.push({ ...t, quantity: 1, board: "commander" });
      } else t.board = "commander";
      return { ...d, cards: mergeDuplicates(d.cards) };
    });
    toast(`${target.name} is now ${partner ? "a" : "your"} commander${replaced.length ? `. ${replaced.join(" and ")} moved to the main deck` : ""}`);
  }

  function setPrinting(target: DeckCard, p: scry.ScryCard) {
    const i = deck.cards.indexOf(target);
    change((d) => {
      Object.assign(d.cards[i], { scryfallId: p.id, set: p.set, collectorNumber: p.collector_number });
      return d;
    });
  }

  async function applyImport(cards: DeckCard[], replace: boolean, name?: string, format?: string, tokens: ParsedToken[] = []) {
    const merged = mergeDuplicates(replace ? cards : [...deck.cards, ...cards]);
    change((d) => ({
      ...d,
      cards: merged,
      name: name && (replace || d.name === UNTITLED) ? name : d.name,
      format: format && FORMATS.includes(format) && replace ? format : d.format,
    }));
    setTab("search");
    toast(`Imported ${cards.reduce((n, c) => n + c.quantity, 0)} cards`);
    await Promise.all([resolveCards(merged), importTokenArt(tokens)]);
    pickExtraColor(merged, replace);
    // Lines that didn't name a printing get your default one; cards already in the deck keep theirs.
    const p = printingPref();
    const unpicked = new Set(cards.filter((c) => !c.scryfallId && !c.set).map((c) => front(c.name)));
    if (p === "default" || !unpicked.size) return;
    const before = new Set(replace ? [] : deck.cards.map((c) => `${c.board}|${front(c.name)}`));
    await repick((c) => unpicked.has(front(c.name)) && !before.has(`${c.board}|${front(c.name)}`), p);
  }

  /**
   * After an import, a commander like Tolabow gets the extra color that lets in the most of the
   * deck's cards, unless the deck already had a pick (a replacing import picks again).
   */
  function pickExtraColor(cards: DeckCard[], replace: boolean) {
    const d = deckRef.current;
    if (d.extraColor && !replace) return;
    const commanders = cards.filter((c) => c.board === "commander").flatMap((c) => scry.cached(c) ?? []);
    const main = cards.flatMap((c) => {
      const card = c.board === "main" ? scry.cached(c) : undefined;
      return card ? [{ card, quantity: c.quantity }] : [];
    });
    const color = bestExtraColor(main, commanders, identityTest(d.format));
    if (color === d.extraColor || (!color && !replace)) return;
    change((x) => ({ ...x, extraColor: color }));
    if (color) toast(`Extra color for ${extraColorChoice(commanders)}: ${COLORS[color]}. Change it under Stats.`);
  }

  /** The token printings an imported list names become this deck's token art. */
  async function importTokenArt(tokens: ParsedToken[]) {
    const known = tokens.filter((t) => t.scryfallId || (t.set && t.collectorNumber));
    if (!known.length) return;
    const asCards: DeckCard[] = known.map((t) => ({ name: t.name, quantity: 1, board: "main", scryfallId: t.scryfallId, set: t.set, collectorNumber: t.collectorNumber }));
    try {
      await scry.resolve(asCards);
      const picks = tokenPicks(asCards.map((c) => (c.scryfallId ? scry.cachedById(c.scryfallId) : scry.cachedPrinting(c.set!, c.collectorNumber!))));
      if (!picks.length) return;
      if (idRef.current) await addTokenArt({ id: idRef.current, picks });
      else pendingTokenArt.current = [...pendingTokenArt.current.filter((p) => !picks.some((q) => q.identity === p.identity)), ...picks];
      toast(`Imported art for ${picks.length} token${picks.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast(`Couldn't import the deck's token art: ${errorMessage(e)}`, "error");
    }
  }

  // ---- Save / delete / export ----
  async function save() {
    if (deleted.current) return;
    if (inFlight.current) {
      again.current = true;
      return;
    }
    const d = deckRef.current;
    if (!d.name.trim()) {
      setSaveError("give the deck a name");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    const savingVersion = version.current;
    const body = { name: d.name, format: d.format, cards: d.cards, extraColor: d.extraColor, bracket: d.bracket, bracketTags: d.bracketTags };
    try {
      if (idRef.current) await updateDeck({ id: idRef.current, ...body });
      else {
        const id = await createDeck(body);
        idRef.current = id;
        if (pendingTokenArt.current.length) {
          const picks = pendingTokenArt.current;
          pendingTokenArt.current = [];
          addTokenArt({ id, picks }).catch((e) => toast(`Couldn't save the deck's token art: ${errorMessage(e)}`, "error"));
        }
        setDeck((x) => ({ ...x, id }));
        replaceQuietly(editorPath(id, searchRef.current));
      }
      setSaveError("");
      setSavedOnce(true);
      if (version.current === savingVersion) setDirty(false);
      else again.current = true;
    } catch (e) {
      setSaveError(errorMessage(e).replace(/\.$/, ""));
    } finally {
      inFlight.current = false;
      setSaving(false);
      if (again.current) {
        again.current = false;
        void saveRef.current();
      }
    }
  }

  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => void saveRef.current(), 800);
    return () => clearTimeout(t);
  }, [deck, dirty]);

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const saveErrorRef = useRef(saveError);
  saveErrorRef.current = saveError;

  // Leaving: save what's pending instead of asking; only ask when the last save failed.
  const guard = useCallback(() => {
    if (!dirtyRef.current) return true;
    if (!saveErrorRef.current) {
      void saveRef.current();
      return true;
    }
    return confirm(`This deck couldn't be saved (${saveErrorRef.current}). Leave anyway?`);
  }, []);
  useLeaveGuard(guard);
  useEffect(() => () => {
    if (dirtyRef.current && !saveErrorRef.current) void saveRef.current();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function remove() {
    const id = idRef.current;
    if (!id) {
      deleted.current = true;
      setDirty(false);
      setTimeout(() => navigate("/decks"));
      return;
    }
    if (!confirm(`Delete "${deck.name}"? This can't be undone.`)) return;
    try {
      deleted.current = true;
      await removeDeck({ id });
      setDirty(false);
      toast("Deck deleted");
      setTimeout(() => navigate("/decks"));
    } catch (e) {
      deleted.current = false;
      toast(errorMessage(e), "error");
    }
  }

  async function copyList() {
    try {
      await navigator.clipboard.writeText(writeDecklist(deck.cards));
      toast("Decklist copied");
    } catch {
      toast("Your browser blocked clipboard access. Use Download instead.", "error");
    }
  }

  function downloadList() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([writeDecklist(deck.cards)], { type: "text/plain" }));
    a.download = `${deck.name.replace(/[^\w\- ]+/g, "").trim() || "deck"}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---- Derived ----
  const count = (board?: Board) =>
    deck.cards.filter((c) => (board ? c.board === board : c.board === "main" || c.board === "commander")).reduce((n, c) => n + c.quantity, 0);
  const total = count();
  const commanders = deck.cards.filter((c) => c.board === "commander").flatMap((c) => scry.cached(c) ?? []);
  const noMax = noMaxDeckSize(commanders);
  const badge =
    deck.format === "commander" ? `${total}/100${noMax ? "+" : ""}` : deck.format === "conquest" ? `${total}/${CONQUEST.minDeckSize}+` : `${total} cards`;
  const badgeOk = deck.format === "commander" ? (noMax ? total >= 100 : total === 100) : deck.format === "conquest" ? total >= CONQUEST.minDeckSize : true;
  const saveState = saving
    ? "Saving…"
    : saveError
      ? `Not saved: ${saveError}`
      : dirty
        ? "Saving soon…"
        : savedOnce
          ? "All changes saved"
          : "Saves automatically";

  if (loadingCards) {
    const count = initial.cards.reduce((n, c) => n + c.quantity, 0);
    return (
      <div className="editor-loading" role="status">
        <a href="#/decks" className="back link">← Your decks</a>
        <div className="spinner" aria-hidden="true" />
        <h2>{deck.name}</h2>
        <p className="muted">Loading {count} cards from Scryfall…</p>
      </div>
    );
  }

  const deckView = (
    <DeckView
      deck={deck}
      missing={missing}
      count={count}
      onQty={setQty}
      onMove={moveCard}
      onTags={setTags}
      onMakeCommander={makeCommander}
      onPrinting={setPrinting}
      onAddCommander={(c) => void addCard(c, "commander")}
      onExtraColor={(c) => change((d) => ({ ...d, extraColor: c }))}
      onBracket={(b) => change((d) => ({ ...d, bracket: b }))}
      onBracketTags={(t) => change((d) => ({ ...d, bracketTags: t.length ? t : undefined }))}
    />
  );

  return (
    <div className="editor">
      <div className="editor-head">
        {/* While searching, the search page's own "Back to deck" is the way back; this one, to the deck list, steps aside. */}
        <a href="#/decks" className={`back${searchQuery !== null ? " minor" : ""}`} title="Back to your decks">{searchQuery !== null ? "← Your decks" : "←"}</a>
        <input className="deck-name" value={deck.name} maxLength={100} aria-label="Deck name" onChange={(e) => change((d) => ({ ...d, name: e.target.value }))} />
        <select aria-label="Format" value={deck.format} onChange={(e) => change((d) => ({ ...d, format: e.target.value }))}>
          {FORMATS.map((f) => <option key={f} value={f}>{capitalize(f)}</option>)}
        </select>
        <FolderSelect deckId={deck.id} />
        <span className="count-badge" data-ok={String(badgeOk)}>{badge}</span>
        <div className="spacer" />
        <span className={`save-state small ${saveError ? "error" : "muted"}`} role="status">{saveState}</span>
        <details className="menu">
          <summary className="btn ghost">Export</summary>
          <div className="menu-list" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute("open")}>
            <button onClick={() => void copyList()}>Copy decklist</button>
            <button onClick={downloadList}>Download .txt</button>
          </div>
        </details>
        <details className="menu">
          <summary className="btn ghost" title="Change the printing of every card in the deck">{repicking ? "Printings…" : "Printings"}</summary>
          <div className="menu-list" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute("open")}>
            {[pref, ...PRINTING_PREFS.map((x) => x.id).filter((x) => x !== pref)].map((x) => (
              <button key={x} disabled={repicking || !deck.cards.length} title={PRINTING_PREFS.find((y) => y.id === x)!.hint} onClick={() => void setAllPrintings(x)}>
                All cards: {prefLabel(x)}{x === pref ? " (your default)" : ""}
              </button>
            ))}
          </div>
        </details>
        <button className="btn ghost danger" onClick={() => void remove()} title="Delete deck">Delete</button>
      </div>
      {searchQuery !== null ? (
        <SearchResults
          query={searchQuery}
          format={deck.format}
          deck={deck.cards}
          commanders={commanders}
          extraColor={deck.extraColor}
          defaultBoard={addTo}
          onDefaultBoard={setAddTo}
          onAdd={addCard}
          onQty={setQty}
          onRemoveOne={removeOne}
          onSearch={setSearchQuery}
          onPickName={(n) => void addByName(n)}
          onClose={() => setSearchQuery(null)}
        />
      ) : (
        <div className="editor-body">
          <aside className="panel left">
            <div className="tabs">
              <button className={`tab${tab === "search" ? " active" : ""}`} onClick={() => setTab("search")}>Search</button>
              <button className={`tab${tab === "import" ? " active" : ""}`} onClick={() => setTab("import")}>Import</button>
            </div>
            <SearchPane hidden={tab !== "search"} addTo={addTo} onAddTo={setAddTo} onPick={(n) => void addByName(n)} onSubmit={setSearchQuery} autoFocus={!deck.cards.length && tab === "search"} identity={identityFilter(deck.format, deck.cards, commanders, deck.extraColor)} />
            <ImportPane hidden={tab !== "import"} startReplacing={deck.cards.length === 0} onImport={applyImport} importFromUrl={(url) => importFromUrl({ url })} autoFocus={tab === "import"} />
          </aside>
          {deckView}
        </div>
      )}
      {searchQuery !== null && (
        <DeckDrawer open={deckOpen} onToggle={() => setDeckOpen((o) => !o)} name={deck.name} badge={badge} badgeOk={badgeOk}>
          {deckView}
        </DeckDrawer>
      )}
    </div>
  );
}

// ---- Search ---------------------------------------------------------------------------

function SearchPane(props: { hidden: boolean; addTo: Board; onAddTo: (b: Board) => void; onPick: (name: string) => void; onSubmit: (q: string) => void; autoFocus: boolean; identity: ReturnType<typeof identityFilter> }) {
  return (
    <div className="pane" hidden={props.hidden}>
      <SearchBox onPick={props.onPick} onSubmit={props.onSubmit} autoFocus={props.autoFocus} identity={props.identity} />
      <div className="search-help">
        <label className="inline small muted">
          Picked names go to{" "}
          <select aria-label="Add cards to" value={props.addTo} onChange={(e) => props.onAddTo(e.target.value as Board)}>
            {BOARDS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </label>
        <p className="muted small">
          Pick a name to add it, or press Enter to see every result with images. Scryfall syntax works too:{" "}
          <a href="https://scryfall.com/docs/syntax" target="_blank" rel="noopener">search syntax</a>.
        </p>
      </div>
    </div>
  );
}

// ---- Import ---------------------------------------------------------------------------

function ImportPane(props: {
  hidden: boolean;
  startReplacing: boolean;
  autoFocus: boolean;
  onImport: (cards: DeckCard[], replace: boolean, name?: string, format?: string, tokens?: ParsedToken[]) => Promise<void>;
  importFromUrl: (url: string) => Promise<{ name: string; format: string; cards: DeckCard[]; tokens: ParsedToken[] }>;
}) {
  const [replace, setReplace] = useState(props.startReplacing);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function fromParsed(parsed: ReturnType<typeof parseDecklist>, fallbackName?: string) {
    if (!parsed.cards.length) {
      return toast(parsed.errors.length ? `Couldn't read any cards (first bad line: "${parsed.errors[0]}")` : "No cards found in that list.", "error");
    }
    await props.onImport(parsed.cards, replace, parsed.name ?? fallbackName, undefined, parsed.tokens);
    setReplace(false);
    if (parsed.errors.length) toast(`Skipped ${parsed.errors.length} line(s) that didn't look like cards: "${parsed.errors[0]}"…`, "error");
  }

  async function fromLink() {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const d = await props.importFromUrl(url.trim());
      await props.onImport(d.cards, replace, d.name, d.format, d.tokens);
      setReplace(false);
      setUrl("");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function fromFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 1_000_000) return toast("That file is too big for a decklist.", "error");
    await fromParsed(parseDecklist(await f.text()), f.name.replace(/\.[^.]+$/, ""));
  }

  return (
    <div className="pane" hidden={props.hidden}>
      <label className="inline small">
        <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace the current list (otherwise add to it)
      </label>
      <section className="import-block">
        <h3>From a link</h3>
        <p className="muted small">Public Moxfield or Archidekt decks.</p>
        <div className="search-row">
          <input type="url" placeholder="https://moxfield.com/decks/…" aria-label="Deck link" value={url} autoFocus={props.autoFocus} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn" disabled={busy} onClick={() => void fromLink()}>{busy ? "Importing…" : "Import link"}</button>
        </div>
      </section>
      <section className="import-block">
        <h3>Paste a list</h3>
        <p className="muted small">Moxfield, Archidekt, Arena or MTGO text exports. One card per line.</p>
        <textarea rows={8} aria-label="Decklist text" placeholder={"Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Sol Ring\n1 Arcane Signet\n…"} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn" onClick={() => void fromParsed(parseDecklist(text)).then(() => setText(""))}>Import text</button>
      </section>
      <section className="import-block">
        <h3>Upload a file</h3>
        <p className="muted small">.txt or .dek decklist.</p>
        <input type="file" accept=".txt,.dek,.dec,.csv,text/plain" aria-label="Decklist file" onChange={(e) => void fromFile(e.target.files?.[0]).then(() => (e.target.value = ""))} />
      </section>
    </div>
  );
}

// ---- The deck -------------------------------------------------------------------------

function DeckView(props: {
  deck: Draft;
  missing: string[];
  count: (b?: Board) => number;
  onQty: (c: DeckCard, q: number) => void;
  onMove: (c: DeckCard, b: Board) => void;
  onTags: (c: DeckCard, tags: string[]) => void;
  onMakeCommander: (c: DeckCard, partner: boolean) => void;
  onPrinting: (c: DeckCard, p: scry.ScryCard) => void;
  onAddCommander: (c: scry.ScryCard) => void;
  onExtraColor: (color: string | undefined) => void;
  onBracket: (b: number | undefined) => void;
  onBracketTags: (tags: string[]) => void;
}) {
  const { deck, missing, count } = props;
  /** "GC" on Game Changers in Commander decks (Commander Brackets). */
  const gameChanger = (s: scry.ScryCard | undefined, className: string) =>
    deck.format === "commander" && s?.game_changer ? <span className={className} title="Game Changer: Exhibition and Core decks allow none, Upgraded up to 3">GC</span> : null;
  const preview = useCardPreview();
  const flips = useFlips();
  const [printingsFor, setPrintingsFor] = useState<DeckCard | null>(null);
  const [pickingPartner, setPickingPartner] = useState(false);
  /** The right-clicked card's menu: where it opened and which entry (by `key`), rebuilt each render. */
  const [menu, setMenu] = useState<{ x: number; y: number; key: string } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [view, setView] = useCardView();
  const stacked = view === "stacked" || view === "spread";
  const [groupBy, setGroupByState] = useState<GroupBy>(savedGroupBy);
  const setGroupBy = (by: GroupBy) => {
    setGroupByState(by);
    saveGroupBy(by);
  };
  /** The card whose tags are being edited (by board and name, so it survives edits). */
  const [tagging, setTagging] = useState<{ board: Board; name: string } | null>(null);
  const [measure, stackCols] = useStackColumns();
  const support = useCardSupport();
  const warnings = useMemo(() => deckWarnings(deck, missing, support), [deck, missing, support]);
  /** The tile's outline class for a card that won't work: red when it's missing, amber for a known issue. */
  const brokenClass = (c: DeckCard, s: scry.ScryCard | undefined) => {
    const st = support?.status(s ?? c.name);
    return !st || st.works ? "" : st.missing ? " not-playable" : " known-issue";
  };
  /** "Not playable" on cards that won't work in a game (src/cardsupport.ts). */
  const notWorking = (c: DeckCard, s: scry.ScryCard | undefined, className: string) => {
    const st = support?.status(s ?? c.name);
    if (!st || st.works) return null;
    return <span className={`${className}${st.missing ? " missing" : ""}`} title={st.reason}>{st.missing ? "Not playable" : "Known issue"}</span>;
  };

  if (!deck.cards.length) {
    return (
      <section className="panel deck-view">
        <div className="empty">
          <h3>This deck is empty</h3>
          <p>Search for cards on the left, or switch to Import to bring in a list.</p>
        </div>
      </section>
    );
  }

  const openDetails = (c: DeckCard, s: scry.ScryCard) => {
    preview.hide();
    showCardDetails(s, [
      { label: "Choose printing…", run: () => setPrintingsFor(c) },
      { label: "Remove from deck", run: () => props.onQty(c, 0) },
    ]);
  };

  const qty = (c: DeckCard) => (
    <span className="qty">
      <button className="qbtn" aria-label="One fewer" onClick={() => props.onQty(c, c.quantity - 1)}>−</button>
      <QtyInput value={c.quantity} label={`Number of ${c.name}`} onChange={(n) => props.onQty(c, n)} />
      <button className="qbtn" aria-label="One more" onClick={() => props.onQty(c, c.quantity + 1)}>+</button>
    </span>
  );

  /**
   * Every action for one deck entry. The same list opens from the "⋯" button and from a
   * right-click on the card (no native <select>).
   */
  const menuSections = (c: DeckCard, s: scry.ScryCard | undefined): MenuSection[] => {
    const boardLabel = BOARDS.find((b) => b.id === c.board)!.label;
    const cmdrs = deck.cards.filter((x) => x.board === "commander");
    const cmdrCards = cmdrs.map((x) => scry.cached(x));
    const commanderFormat = deck.format === "commander" || deck.format === "conquest";
    const eligible = commanderFormat && c.board !== "commander" && !!s && canCommand(s, deck.format);
    const asPartner = eligible && cmdrs.length === 1 && !!cmdrCards[0] && canPair(cmdrCards[0], s!);
    const commanderItems: MenuItem[] = !eligible
      ? []
      : [
          ...(asPartner ? [{ label: "★ Add as second commander", onSelect: () => props.onMakeCommander(c, true) }] : []),
          { label: cmdrs.length ? (cmdrs.length > 1 ? "★ Make commander (replaces both)" : `★ Make commander (replaces ${cmdrs[0].name})`) : "★ Make commander", onSelect: () => props.onMakeCommander(c, false) },
        ];
    const sections: MenuSection[] = [
      {
        title: `${c.quantity} × ${c.name} · ${boardLabel}`,
        items: [
          { label: "+ Add one", keepOpen: true, onSelect: () => props.onQty(c, c.quantity + 1) },
          { label: "− Remove one", keepOpen: c.quantity > 1, onSelect: () => props.onQty(c, c.quantity - 1) },
          { label: "Add", onSelect: () => {}, amount: { initial: 1, min: 1, max: MAX_QUANTITY - c.quantity, button: "Add", onAmount: (n) => props.onQty(c, c.quantity + n) } },
          { label: "Set to", onSelect: () => {}, amount: { initial: c.quantity, min: 0, max: MAX_QUANTITY, button: "Set", onAmount: (n) => props.onQty(c, n) } },
        ],
      },
      {
        items: [
          { label: "Card details", disabled: !s, onSelect: () => s && openDetails(c, s) },
          { label: "Choose printing…", onSelect: () => setPrintingsFor(c) },
          { label: c.tags?.length ? `Tags: ${c.tags.join(", ")}` : "Add tags…", onSelect: () => setTagging({ board: c.board, name: c.name }) },
        ],
      },
      { items: commanderItems },
      {
        title: "Move to",
        items: BOARDS.filter((b) => b.id !== c.board && !(b.id === "commander" && eligible)).map((b) => ({ label: b.label, onSelect: () => props.onMove(c, b.id) })),
      },
      { items: [{ label: c.quantity > 1 ? `Remove all ${c.quantity}` : "Remove from deck", danger: true, onSelect: () => props.onQty(c, 0) }] },
    ];
    return sections.filter((sec) => sec.items.length);
  };

  const cardMenu = (c: DeckCard, s: scry.ScryCard | undefined, className?: string) => (
    <CardMenu label={`Options for ${c.name}`} className={className} sections={menuSections(c, s)} />
  );

  /** Right-clicking a card opens the same menu at the pointer. */
  const onContextMenu = (c: DeckCard) => (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("input")) return; // the quantity box keeps the browser's menu (paste)
    e.preventDefault();
    preview.hide();
    setMenu({ x: e.clientX, y: e.clientY, key: key(c, deck.cards.indexOf(c)) });
  };

  const key = (c: DeckCard, i: number) => `${c.board}|${c.name}|${c.scryfallId ?? i}`;
  const menuCard = menu && deck.cards.find((c, i) => key(c, i) === menu.key);
  const contextMenu: ContextMenuState | null = menuCard ? { x: menu.x, y: menu.y, sections: menuSections(menuCard, scry.cached(menuCard)) } : null;

  const row = (c: DeckCard, i: number) => {
    const s = scry.cached(c);
    return (
      <li key={key(c, i)} className={s ? "card-row" : "card-row unresolved"} {...preview.handlers(s)} onContextMenu={onContextMenu(c)}>
        {qty(c)}
        {s ? <button className="cname" title="Card details" onClick={() => openDetails(c, s)}>{c.name}</button> : <span className="cname">{c.name}</span>}
        {notWorking(c, s, "nw-badge")}
        {gameChanger(s, "gc-badge")}
        {c.tags?.length ? <span className="row-tags" title={`Tags: ${c.tags.join(", ")}`}>{c.tags.join(" · ")}</span> : null}
        {s ? <ManaCost cost={s.mana_cost ?? s.card_faces?.map((f) => f.mana_cost).filter(Boolean).join(" // ")} /> : <span className="muted small">{missing.includes(c.name) ? "not found" : ""}</span>}
        {cardMenu(c, s)}
      </li>
    );
  };

  /**
   * A card image. In the grid nothing ever covers the bottom of the card, where the artist and
   * copyright line is (Scryfall's image rules); in the overlapping views only the top of each card
   * shows (the last one shows whole) and hovering previews the whole card. The options button
   * appears over the top-right corner on hover, the quantity over the top when there's more than one.
   */
  const tile = (c: DeckCard, i: number) => tileOf(c, i, stacked);
  /** `overlapped`: only the card's top shows, so hovering previews the whole card. */
  const tileOf = (c: DeckCard, i: number, overlapped: boolean) => {
    const s = scry.cached(c);
    const face = flips.face(s);
    const img = s && scry.imageUrl(s, "normal", face);
    return (
      <div key={key(c, i)} className={`card-tile${s ? "" : " unresolved"}${brokenClass(c, s)}`} {...(overlapped ? preview.handlers(s, face) : {})} onContextMenu={onContextMenu(c)}>
        <button className="tile-img" title={overlapped ? undefined : s ? `${c.name}: card details` : c.name} aria-label={`${c.quantity} × ${c.name}: card details`} disabled={!s} onClick={() => s && openDetails(c, s)}>
          {img ? <img src={img} alt={c.name} loading="lazy" /> : <span className="noimg">{c.name}{missing.includes(c.name) ? " (not found)" : ""}</span>}
        </button>
        {/* The name as invisible text over the printed one, so the browser's find (Ctrl+F) finds and highlights cards. */}
        {img && <span className="tile-name" aria-hidden="true">{c.name}</span>}
        <FlipButton card={s} face={face} onFlip={flips.toggle} />
        {notWorking(c, s, "nw-badge tile-nw")}
        {gameChanger(s, "gc-badge tile-gc")}
        {c.quantity > 1 && <span className="tile-qty" aria-label={`${c.quantity} copies`}>×{c.quantity}</span>}
        {cardMenu(c, s, "tile-menu")}
      </div>
    );
  };

  /** Overlapping cards in a column (Stacked, Spread), or two or three side by side for a big group. */
  const stackBody = (cards: DeckCard[], span = 1) => (
    <div className="stack-pair">
      {columnsOf(cards, span).map((g, i) => <div key={i} className={`stack ${view}`}>{g.map(tile)}</div>)}
    </div>
  );
  const stack = (cards: DeckCard[], k: string, head?: React.ReactNode, span = 1) => (
    <div key={k} className={stackColClass(span)}>
      {head}
      {stackBody(cards, span)}
    </div>
  );
  /** Cards that aren't split by type (commander, considering): rows, a grid, or columns of up to 10. */
  /** `tiled`: never overlap, even in Stacked and Spread (the commanders, so both show whole). */
  const plain = (cards: DeckCard[], extra?: React.ReactNode, tiled = false) => {
    if (view === "list") return <ul className="flat">{cards.map(row)}{extra && <li>{extra}</li>}</ul>;
    if (view === "grid" || tiled) return <div className="card-tiles">{cards.map((c, i) => tileOf(c, i, false))}{extra}</div>;
    const cols: DeckCard[][] = [];
    for (let i = 0; i < cards.length; i += 10) cols.push(cards.slice(i, i + 10));
    return (
      <div className="stack-groups" ref={measure}>
        {cols.map((g, i) => stack(g, String(i)))}
        {extra && <div className={stackColClass(1)}>{extra}</div>}
      </div>
    );
  };

  // One commander that can have a second one (partner, Background, Doctor's companion, ...): an
  // empty slot beside it that opens a picker of the cards it can pair with.
  const soloCommander = deck.cards.filter((c) => c.board === "commander");
  const leadCard = soloCommander.length === 1 && soloCommander[0].quantity === 1 ? scry.cached(soloCommander[0]) : undefined;
  const slotLabel = (deck.format === "commander" || deck.format === "conquest") && leadCard ? partnerSlotLabel(leadCard) : undefined;
  const partnerSlot = slotLabel ? (
    <button className={`partner-slot ${view === "list" ? "row" : "tile"}`} onClick={() => setPickingPartner(true)} title={`Choose a second commander for ${leadCard!.name}`}>
      <span className="partner-plus" aria-hidden="true">+</span>
      <span>Add {slotLabel}</span>
    </button>
  ) : undefined;

  return (
    <section className="panel deck-view">
      {warnings.length > 0 && <ul className="warnings">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {deck.format === "conquest" && (
        <p className="format-note muted small">
          <strong>Conquest: </strong>
          {CONQUEST.startingLife} life ({CONQUEST.startingLifeTwoPlayer} in 1v1) · {CONQUEST.commanderDamage} commander damage · {CONQUEST.minDeckSize}+ cards, singleton ·
          hybrid cards count as either color · players after the first scry before the game.{" "}
          <a href={CONQUEST.rulesUrl} target="_blank" rel="noopener">Full rules ↗</a>
        </p>
      )}
      <DeckBracket
        cards={deck.cards}
        commander={deck.format === "commander"}
        bracket={deck.bracket}
        tags={deck.bracketTags ?? []}
        onBracket={props.onBracket}
        onTags={props.onBracketTags}
      />
      <div className="deck-controls">
        <CardViewToggle view={view} onChange={setView} />
        <label className="group-by">
          <span className="muted">Group by</span>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
            {GROUPINGS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </label>
      </div>
      {(() => {
        const sum = (g: DeckCard[]) => g.reduce((n, c) => n + c.quantity, 0);
        const commanders = [...deck.cards.filter((c) => c.board === "commander")].sort((a, z) => a.name.localeCompare(z.name));
        const main = deck.cards.filter((c) => c.board === "main");
        // Grouped by type, a few main-deck planeswalkers sit beside the commander(s) instead of further down.
        const walkers = groupBy === "type" ? main.filter((c) => scry.primaryType(scry.cached(c)) === "Planeswalker") : [];
        const besideCommander = commanders.length > 0 && walkers.length > 0 && walkers.length <= MAX_WALKERS_BESIDE_COMMANDER;

        type Group = CardGroup & { whole?: boolean; extra?: React.ReactNode };
        const head = (g: Group) => (
          <h4>
            {g.label}
            <span className="muted"> {sum(g.cards)}</span>
          </h4>
        );
        const groupsOf = (cards: DeckCard[]): Group[] => groupCards(cards, groupBy, scry.cached);
        const commanderGroup: Group = { key: "commander", label: commanders.length > 1 ? "Commanders" : "Commander", cards: commanders, whole: true, extra: partnerSlot };
        /** The walkers group moved up next to the commander. */
        const walkersFirst = (groups: Group[]) => {
          const i = groups.findIndex((g) => g.key === "type:Planeswalker");
          return besideCommander && i > 0 ? [groups[i], ...groups.slice(0, i), ...groups.slice(i + 1)] : groups;
        };

        /** Stacked: columns of overlapping cards; small groups share a column when they fit. */
        const packed = (groups: Group[]) => {
          const slots = packStacks(groups.map((g) => ({ size: g.cards.length + (g.extra ? 1 : 0), whole: g.whole })), stackCols, 0.15);
          return (
            <div className="stack-groups" ref={measure}>
              {slots.map((slot) => (
                <div key={groups[slot.groups[0]].key} className={`${stackColClass(slot.span)} stack-slot`}>
                  {slot.groups.map((i) => {
                    const g = groups[i];
                    return (
                      <div key={g.key} className="stack-group">
                        {head(g)}
                        {g.whole ? (
                          <div className="card-tiles whole-col">{g.cards.map((c, j) => tileOf(c, j, false))}{g.extra}</div>
                        ) : (
                          stackBody(g.cards, slot.span)
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        };

        /**
         * Spread: each group's cards across the page in rows, every row covering all but the name
         * and art of the one above (the last row shows whole). Small groups sit side by side.
         */
        const rows = (groups: Group[]) => (
          <div className="row-groups" ref={measure}>
            {groups.map((g) => {
              const n = g.cards.length + (g.extra ? 1 : 0);
              const across = Math.max(1, Math.min(n, stackCols || 6));
              const lastRow = n - (n % across || across);
              return (
                <div key={g.key} className="row-group" style={{ width: across * 150 + (across - 1) * 14 }}>
                  {head(g)}
                  <div className={`stack-rows${g.whole ? " whole" : ""}`} style={{ gridTemplateColumns: `repeat(${across}, 150px)` }}>
                    {g.cards.map((c, i) => (
                      <div key={key(c, i)} className={i >= lastRow ? "row-cell last-row" : "row-cell"}>
                        {tileOf(c, i, !g.whole && i < lastRow)}
                      </div>
                    ))}
                    {g.extra && <div className="row-cell last-row">{g.extra}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        );

        /** Grid and List: whole cards or names, each group under its heading. */
        const flat = (groups: Group[]) => (
          <div className={view === "grid" ? "image-groups" : "type-groups"}>
            {groups.map((g) => (
              <div key={g.key} className="type-group">
                {head(g)}
                {view === "grid" ? <div className="card-tiles">{g.cards.map(tile)}</div> : <ul>{g.cards.map(row)}</ul>}
              </div>
            ))}
          </div>
        );

        const laid = (groups: Group[]) => (view === "stacked" ? packed(groups) : view === "spread" ? rows(groups) : flat(groups));
        const section = (k: string, title: string, cards: DeckCard[], body: React.ReactNode) => (
          <section key={k} className="board">
            <h2>{title}<span className="muted"> {sum(cards)}</span></h2>
            {body}
          </section>
        );
        const other = (b: Board) => {
          const cards = deck.cards.filter((c) => c.board === b);
          if (!cards.length) return null;
          const label = BOARDS.find((x) => x.id === b)!.label;
          // Considering is a short list: no groups.
          return section(b, label, cards, b === "maybe" ? plain([...cards].sort((a, z) => a.name.localeCompare(z.name))) : laid(groupsOf(cards)));
        };

        // Stacked and Spread: the commander is the first group of the deck, beside the others.
        if (stacked) {
          const groups = walkersFirst(groupsOf(main));
          return (
            <>
              {(commanders.length > 0 || main.length > 0) &&
                section("deck", commanders.length ? "Deck" : "Main deck", [...commanders, ...main], laid(commanders.length || partnerSlot ? [commanderGroup, ...groups] : groups))}
              {other("side")}
              {other("maybe")}
            </>
          );
        }

        // Grid and List: the commander(s) on top, with a few planeswalkers beside them.
        const mainGroups = groupsOf(besideCommander ? main.filter((c) => !walkers.includes(c)) : main);
        const commanderBoard = commanders.length ? section("commander", "Commander", commanders, plain(commanders, partnerSlot, true)) : null;
        return (
          <>
            {besideCommander ? (
              <div className="top-row">
                {commanderBoard}
                <section className="board walkers">
                  <h2>Planeswalkers<span className="muted"> {sum(walkers)} · main deck</span></h2>
                  {plain(walkers.sort((a, z) => (scry.cached(a)?.cmc ?? 0) - (scry.cached(z)?.cmc ?? 0) || a.name.localeCompare(z.name)))}
                </section>
              </div>
            ) : (
              commanderBoard
            )}
            {main.length > 0 && section("main", "Main deck", main, laid(mainGroups))}
            {other("side")}
            {other("maybe")}
          </>
        );
      })()}
      <Stats deck={deck} count={count} onExtraColor={props.onExtraColor} />
      <ColorStats
        cards={deck.cards}
        identity={deck.format === "commander" || deck.format === "conquest" ? [...new Set(deck.cards.filter((c) => c.board === "commander").flatMap((c) => scry.cached(c)?.color_identity ?? []))] : undefined}
      />
      <DeckTokens deckId={deck.id} cards={deck.cards} />
      {preview.element}
      {contextMenu && <ContextMenu menu={contextMenu} onClose={closeMenu} />}
      {tagging && (() => {
        const c = deck.cards.find((x) => x.board === tagging.board && x.name === tagging.name);
        return c ? <TagEditor card={c} suggestions={deckTags(deck.cards)} onChange={(t) => props.onTags(c, t)} onClose={() => setTagging(null)} /> : null;
      })()}
      {printingsFor && <Printings card={printingsFor} onPick={(p) => props.onPrinting(printingsFor, p)} onClose={() => setPrintingsFor(null)} />}
      {pickingPartner && leadCard && slotLabel && (
        <PartnerPicker commander={leadCard} label={slotLabel} onPick={props.onAddCommander} onClose={() => setPickingPartner(false)} />
      )}
    </section>
  );
}

/**
 * The number of copies, typed straight in: Enter or leaving the box applies it, Escape puts it
 * back, 0 removes the card.
 */
function QtyInput({ value, label, onChange }: { value: number; label: string; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Math.floor(Number(draft));
    if (draft.trim() === "" || !Number.isFinite(n) || n < 0) return setDraft(String(value));
    if (n !== value) onChange(Math.min(n, MAX_QUANTITY));
    else setDraft(String(value));
  };
  return (
    <input
      className="qty-input"
      type="text"
      inputMode="numeric"
      aria-label={label}
      title="Type a number of copies (0 removes the card)"
      value={draft}
      size={3}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          setDraft(String(value));
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

function deckWarnings(deck: Draft, missing: string[], support?: CardSupport): string[] {
  const { problems, notes } = checkDeck(deck, scry.cached, support, missing);
  return [...problems, ...notes];
}

function Stats({ deck, count, onExtraColor }: { deck: Draft; count: (b?: Board) => number; onExtraColor: (color: string | undefined) => void }) {
  const main = deck.cards.flatMap((c) => {
    const card = c.board === "main" ? scry.cached(c) : undefined;
    return card ? [{ name: c.name, quantity: c.quantity, card }] : [];
  });
  const lands = main.filter((e) => scry.primaryType(e.card) === "Land").reduce((n, e) => n + e.quantity, 0);
  const landBacks = main.filter((e) => playableLandBack(e.card));
  const landBackCount = landBacks.reduce((n, e) => n + e.quantity, 0);
  const mainCount = main.reduce((n, e) => n + e.quantity, 0);
  const avg = deckAverages(main.map((e) => ({ quantity: e.quantity, cmc: e.card.cmc ?? 0, land: scry.primaryType(e.card) === "Land" })));
  const fmt = (n: number | undefined) => (n === undefined ? "—" : n.toFixed(2));
  const commanders = deck.cards.filter((c) => c.board === "commander").flatMap((c) => scry.cached(c) ?? []);
  const identity = [...new Set(commanders.flatMap((c) => c.color_identity))];
  const extraFor = deck.format === "commander" || deck.format === "conquest" ? extraColorChoice(commanders) : undefined;
  return (
    <section className="board stats">
      <h2>Stats</h2>
      <div className="stats-body">
        <ManaCurve cards={main} />
        <div className="stat-list">
          {(deck.format === "commander" || deck.format === "conquest") && (
            <p>
              <span className="muted">Color identity </span>
              {identity.length ? (
                <>
                  <ManaCost cost={identity.map((x) => `{${x}}`).join("")} />
                  <span className="muted small"> {identity.map((x) => COLORS[x]).join(", ")}</span>
                </>
              ) : (
                <span>—</span>
              )}
            </p>
          )}
          {extraFor && (
            <p>
              <label>
                <span className="muted">Extra color for {extraFor} </span>
                <select value={deck.extraColor ?? ""} onChange={(e) => onExtraColor(e.target.value || undefined)}>
                  <option value="">Not chosen</option>
                  {Object.entries(COLORS)
                    .filter(([x]) => !identity.includes(x))
                    .map(([x, name]) => <option key={x} value={x}>{name}</option>)}
                </select>
              </label>
            </p>
          )}
          <p>
            <span className="muted">Lands </span>
            {lands}
            {landBackCount > 0 && (
              <span className="land-backs" tabIndex={0} aria-label={`plus ${landBackCount} modal double-faced ${landBackCount === 1 ? "card" : "cards"} that can be played as a land`}>
                + {landBackCount}
                <span className="curve-tip land-backs-tip" role="tooltip">
                  <strong>Can be played as a land</strong>
                  <ul>
                    {landBacks.map((e) => (
                      <li key={e.name}>
                        {e.quantity > 1 && <span className="muted">{e.quantity} × </span>}
                        {e.name}
                      </li>
                    ))}
                  </ul>
                </span>
              </span>
            )}
          </p>
          <p title="Average mana value of the main deck, counting lands as 0">
            <span className="muted">Average mana value </span>
            {fmt(avg.withLands)}
            <span className="muted small"> with lands</span>
          </p>
          <p title="Average mana value of the main deck's nonland cards">
            <span className="muted">Average mana value </span>
            {fmt(avg.withoutLands)}
            <span className="muted small"> without lands</span>
          </p>
          <p title={`Lands you can expect in a 7-card opening hand: 7 × ${lands} lands ÷ ${mainCount} cards`}>
            <span className="muted">Lands per opening hand </span>
            {fmt(avg.landsPerHand)}
          </p>
          <p><span className="muted">Sideboard / maybe </span>{count("side")} / {count("maybe")}</p>
        </div>
      </div>
    </section>
  );
}

function Printings({ card, onPick, onClose }: { card: DeckCard; onPick: (p: scry.ScryCard) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [prints, setPrints] = useState<scry.ScryCard[] | null>(null);
  const [error, setError] = useState("");
  const flips = useFlips();
  useEffect(() => {
    ref.current?.showModal();
    scry.printings(card.name).then(setPrints).catch((e) => setError(errorMessage(e)));
  }, [card.name]);
  return (
    <dialog ref={ref} className="printings" onClose={onClose} onClick={(e) => closeOnBackdrop(e.nativeEvent, ref.current)}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <div className="dialog-head">
        <h3>Printings of {card.name}</h3>
      </div>
      {error ? <p className="form-error">{error}</p> : !prints ? <p className="muted">Loading…</p> : (
        <div className="results">
          {prints.map((p) => (
            <div key={p.id} className="flip-host">
              <button
                className={p.id === card.scryfallId ? "result-img selected" : "result-img"}
                title={`${p.set_name} #${p.collector_number}`}
                onClick={() => {
                  onPick(p);
                  ref.current?.close();
                }}
              >
                <img src={scry.imageUrl(p, "normal", flips.face(p)) ?? ""} alt={p.set_name} loading="lazy" />
                <span className="small muted">{p.set.toUpperCase()} #{p.collector_number}</span>
                {scry.artistOf(p) && <span className="small muted">{scry.artistOf(p)}</span>}
              </button>
              <FlipButton card={p} face={flips.face(p)} onFlip={flips.toggle} />
            </div>
          ))}
        </div>
      )}
    </dialog>
  );
}

/** Which folder the deck is in. Moves straight away (not part of autosave); a deck not saved yet can't be filed. */
function FolderSelect({ deckId }: { deckId?: Id<"decks"> }) {
  const folders = useQuery(api.folders.list);
  const saved = useQuery(api.decks.get, deckId ? { id: deckId } : "skip");
  const moveDeck = useMutation(api.decks.move);
  if (!deckId || !folders?.length || !saved) return null;
  const current = saved.folderId ?? "";
  return (
    <select
      aria-label="Folder"
      title="The folder this deck is in"
      value={current}
      onChange={(e) => moveDeck({ id: deckId, folderId: (e.target.value || null) as Id<"deckFolders"> | null }).catch((err) => toast(errorMessage(err), "error"))}
    >
      <option value="">No folder</option>
      {folders.map((f) => <option key={f._id} value={f._id}>📁 {f.name}</option>)}
    </select>
  );
}

/**
 * The deck, while browsing search results: a bar along the bottom of the window. Clicking the bar
 * slides the deck up over part of the screen, the same deck view as the editor (change counts,
 * move or remove cards, ...); clicking its top bar again (or Escape) lowers it.
 */
function DeckDrawer({ open, onToggle, name, badge, badgeOk, children }: { open: boolean; onToggle: () => void; name: string; badge: string; badgeOk: boolean; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open], .card-menu")) onToggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onToggle]);
  return (
    <div className={`deck-drawer${open ? " open" : ""}`} role="region" aria-label="Your deck">
      <button className="deck-drawer-bar" aria-expanded={open} onClick={onToggle} title={open ? "Lower the deck" : "Show your deck"}>
        <span className="deck-drawer-grip" aria-hidden="true" />
        <span className="deck-drawer-title">
          <strong>{name}</strong>
          <span className="count-badge" data-ok={String(badgeOk)}>{badge}</span>
        </span>
        <span className="deck-drawer-toggle">{open ? "Hide deck ▾" : "Show deck ▴"}</span>
      </button>
      {open && <div className="deck-drawer-body">{children}</div>}
    </div>
  );
}

/** The cards that can be the second commander beside `commander`, from Scryfall. */
function PartnerPicker({ commander, label, onPick, onClose }: { commander: scry.ScryCard; label: string; onPick: (c: scry.ScryCard) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [cards, setCards] = useState<scry.ScryCard[] | null>(null);
  const [next, setNext] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const support = useCardSupport();
  const flips = useFlips();
  const fits = (cs: scry.ScryCard[]) => cs.filter((c) => canPair(commander, c));
  useEffect(() => {
    ref.current?.showModal();
    const q = partnerQuery(commander);
    if (!q) return setCards([]);
    scry.search(q).then(
      (p) => (setCards(fits(p.cards)), setNext(p.nextPage)),
      (e) => setError(errorMessage(e)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commander.id]);
  async function more() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const p = await scry.nextPage(next);
      setCards((c) => [...(c ?? []), ...fits(p.cards)]);
      setNext(p.nextPage);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }
  return (
    <dialog ref={ref} className="printings partner-picker" onClose={onClose} onClick={(e) => closeOnBackdrop(e.nativeEvent, ref.current)}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <div className="dialog-head">
        <h3>Add {label}</h3>
        <p className="muted small">Cards that can be your second commander beside {commander.name}.</p>
      </div>
      {error ? <p className="form-error">{error}</p> : !cards ? <p className="muted">Loading…</p> : !cards.length ? <p className="muted">Scryfall has no cards that pair with {commander.name}.</p> : (
        <div className="results">
          {cards.map((c) => {
            const st = support?.status(c);
            const face = flips.face(c);
            return (
              <div key={c.id} className="flip-host">
                <button
                  className="result-img"
                  title={st && !st.works ? `${c.name}: ${st.reason}` : `Add ${c.name} as a commander`}
                  onClick={() => {
                    onPick(c);
                    ref.current?.close();
                  }}
                >
                  {scry.imageUrl(c, "normal", face) ? <img src={scry.imageUrl(c, "normal", face)} alt={c.name} loading="lazy" /> : <span className="noimg">{c.name}</span>}
                  <span className="small">{c.name}</span>
                  {st && !st.works && <span className="small form-error">{st.missing ? "Not playable yet" : "Known issue"}</span>}
                </button>
                <FlipButton card={c} face={face} onFlip={flips.toggle} />
              </div>
            );
          })}
          {next && (
            <button className="btn ghost wide partner-more" disabled={loadingMore} onClick={() => void more()}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </dialog>
  );
}

/** A card's tags: chips to remove, the deck's other tags to add with a click, or a new one typed in. */
function TagEditor({ card, suggestions, onChange, onClose }: { card: DeckCard; suggestions: string[]; onChange: (tags: string[]) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState("");
  useEffect(() => ref.current?.showModal(), []);
  const tags = card.tags ?? [];
  const has = (t: string) => tags.some((x) => x.toLowerCase() === t.toLowerCase());
  const full = tags.length >= MAX_CARD_TAGS;
  const others = suggestions.filter((t) => !has(t));
  function add(e: React.FormEvent) {
    e.preventDefault();
    const t = draft.trim().replace(/\s+/g, " ");
    if (t && !has(t) && !full) onChange([...tags, t]);
    setDraft("");
  }
  return (
    <dialog ref={ref} className="new-deck tag-editor" onClose={onClose} onClick={(e) => closeOnBackdrop(e.nativeEvent, ref.current)}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <form onSubmit={add}>
        <h3>Tags for {card.name}</h3>
        <p className="muted small">Group the deck by your tags with Group by → Tag, or Type &amp; tag. A card can have several.</p>
        <div className="reason-tags">
          {tags.length ? (
            tags.map((t) => (
              <button type="button" key={t} className="reason-tag on" title="Remove this tag" onClick={() => onChange(tags.filter((x) => x !== t))}>
                {t} <span aria-hidden="true">×</span>
              </button>
            ))
          ) : (
            <span className="muted small">No tags yet.</span>
          )}
        </div>
        {others.length > 0 && (
          <div>
            <p className="muted small tag-editor-sub">Used in this deck</p>
            <div className="reason-tags">
              {others.map((t) => (
                <button type="button" key={t} className="reason-tag" disabled={full} onClick={() => onChange([...tags, t])}>+ {t}</button>
              ))}
            </div>
          </div>
        )}
        <div className="tag-editor-add">
          <input
            autoFocus
            value={draft}
            maxLength={MAX_CARD_TAG_LENGTH}
            disabled={full}
            placeholder={full ? `At most ${MAX_CARD_TAGS} tags` : "New tag, e.g. Ramp, Win condition"}
            aria-label="New tag"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="btn" disabled={!draft.trim() || full}>Add</button>
        </div>
        <div className="actions new-deck-actions">
          <button type="button" className="btn ghost" onClick={() => ref.current?.close()}>Done</button>
        </div>
      </form>
    </dialog>
  );
}
