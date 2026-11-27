import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_CARD_TAG_LENGTH, MAX_CARD_TAGS, MAX_QUANTITY, cleanCardTags, cleanCategory, type Board, type DeckCard } from "../../convex/model/deckRules";
import { errorMessage } from "../app/errors";
import { navigate, replaceQuietly, useLeaveGuard, useRoute } from "../app/router";
import { closeOnBackdrop, showCardDetails } from "../carddetails";
import { CARD_TYPE, cardDragData, looksLikeCard, readDeckCards, readDrop, type DroppedCard } from "../carddrop";
import { useCardSupport, type CardSupport } from "../cardsupport";
import { mergeDuplicates, parseDecklist, writeDecklist, type ParsedToken } from "../decklist";
import { dismissToastAction, toast } from "../dom";
import { CardMenu, Keys, type MenuItem, type MenuSection } from "../components/CardMenu";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu";
import { ColorStats } from "../components/ColorStats";
import { DeckBar, DeckTypeCounts } from "../components/DeckBar";
import { DeckBracket } from "../components/DeckBracket";
import { deckAverages, playableLandBack } from "../deckstats";
import { CARD_LIST, FORMATS, formatLabel, isPlainList, PACKAGE, hasCommander } from "../deckFormats";
import { AddToPackage } from "../components/AddToPackage";
import { AddToDeck } from "../components/AddToDeck";
import { boxBetween, caught, visibleParts, type Box } from "../marquee";
import { cardLines, DECK_SHORTCUTS, deckShortcut, type DeckShortcut } from "../deckShortcuts";
import { PackagesPane } from "../components/PackagesPane";
import { MAX_PACKAGE_NAME, MAX_PACKAGE_NOTE } from "../../convex/model/packageRules";
import { cardKey, copiesIn, type PackageEntry } from "../packages";
import { DeckCombos } from "../components/DeckCombos";
import { DeckAbilities } from "../components/DeckAbilities";
import { DeckTokens } from "../components/DeckTokens";
import { FlipButton, useFlips } from "../components/FlipButton";
import { CardViewToggle, useCardView, useStackColumns } from "../cardView";
import { ManaCurve } from "../components/ManaCurve";
import { columnsOf, packStacks, stackColClass } from "../stackLayout";
import { DEFAULT_GROUPING, GROUPINGS, categoryOf, deckCategories, deckTags, fittingCategories, groupCards, isGroupBy, type AutoCategories, type CardGroup, type GroupBy } from "../deckGroups";
import { useCardCategories } from "../useCardCategories";
import { ManaCost } from "../components/ManaCost";
import { CardImg, CardWait } from "../components/CardImg";
import { KnownPrintings } from "../components/KnownPrintings";
import { BusyLabel, Loading, ScryfallWaiting, Spinner } from "../components/Spinner";
import { CONQUEST } from "../formats/conquest";
import { checkDeck, identityTest } from "../deckcheck";
import { canPair, partnerQuery, partnerSlotLabel } from "../formats/partners";
import { bestExtraColor, extraColorChoice, noMaxDeckSize } from "../formats/rulebreakers";
import { PRINTING_PREFS, prefLabel, type PrintingPref } from "../printings";
import * as scry from "../scryfall";
import { tokenPicks } from "../tokens";
import { useCardPreview } from "../useCardPreview";
import { printingPref, usePrintingPref } from "../usePrintingPref";
import { BOARDS, boardLabel, boardsFor } from "./boards";
import { canCommand, identityFilter, SearchBox, SearchResults } from "./EditorSearch";

/** Up to this many main-deck planeswalkers are shown beside the commander(s). */
const MAX_WALKERS_BESIDE_COMMANDER = 3;

const COLORS: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const UNTITLED = "Untitled deck";
const UNTITLED_PACKAGE = "Untitled package";
const UNTITLED_NAMES = [UNTITLED, UNTITLED_PACKAGE, "Untitled list"];
/** A card name compared without case or its back face ("Delver of Secrets // Insectile Aberration"). */
const front = (name: string) => name.split(" // ")[0].toLowerCase();

type TokenPick = { identity: string; scryfallId: string };

interface Draft {
  /** A deck's id, or a package's. */
  id?: string;
  name: string;
  /** `PACKAGE` for a package. */
  format: string;
  /** A package's note. */
  note?: string;
  cards: DeckCard[];
  /** The color a Rulebreaker commander like Tolabow lets this deck add. */
  extraColor?: string;
  /** The Commander bracket the player gives the deck, and their reasons (src/brackets.ts). */
  bracket?: number;
  bracketTags?: string[];
}

/** The editor's URL: the deck (or a new one) and the search open in it, if any. */
function editorPath(format: string, id: string | undefined, search: string | null) {
  return `${format === PACKAGE ? "/decks/packages" : "/decks"}/${id ?? "new"}${search ? `?${new URLSearchParams({ q: search })}` : ""}`;
}

/** What the editor calls the thing being edited. */
const nounOf = (format: string) => (format === PACKAGE ? "package" : format === CARD_LIST ? "list" : "deck");

/** Where the editor keeps what it edits: your decks (and card lists), or your packages. */
function useStore(isPackage: boolean) {
  const deck = { create: useMutation(api.decks.create), update: useMutation(api.decks.update), remove: useMutation(api.decks.remove), groupBy: useMutation(api.decks.setGroupBy) };
  const pkg = { create: useMutation(api.packages.create), update: useMutation(api.packages.update), remove: useMutation(api.packages.remove), groupBy: useMutation(api.packages.setGroupBy) };
  const deckBody = (d: Draft) => ({ name: d.name, format: d.format, cards: d.cards, extraColor: d.extraColor, bracket: d.bracket, bracketTags: d.bracketTags });
  const packageBody = (d: Draft) => ({ name: d.name, note: d.note, cards: d.cards });
  return {
    create: async (d: Draft): Promise<string> => (isPackage ? pkg.create(packageBody(d)) : deck.create(deckBody(d))),
    update: async (id: string, d: Draft): Promise<unknown> =>
      isPackage ? pkg.update({ id: id as Id<"packages">, ...packageBody(d) }) : deck.update({ id: id as Id<"decks">, ...deckBody(d) }),
    remove: async (id: string): Promise<unknown> => (isPackage ? pkg.remove({ id: id as Id<"packages"> }) : deck.remove({ id: id as Id<"decks"> })),
    setGroupBy: async (id: string, groupBy: GroupBy): Promise<unknown> =>
      isPackage ? pkg.groupBy({ id: id as Id<"packages">, groupBy }) : deck.groupBy({ id: id as Id<"decks">, groupBy }),
  };
}

/** The same editor for a package: one list of cards, without a commander, boards or a format. */
export function PackageEditor({ id }: { id?: string }) {
  const saved = useQuery(api.packages.get, id ? { id } : "skip");
  if (id && saved === undefined) return <Loading text="Opening the package…" />;
  if (id && saved === null) {
    return (
      <>
        <p className="form-error">Package not found.</p>
        <a href="#/decks/packages" className="link">← Back to packages</a>
      </>
    );
  }
  const initial: Draft = saved ? { id: saved._id, name: saved.name, note: saved.note, format: PACKAGE, cards: saved.cards } : { name: UNTITLED_PACKAGE, format: PACKAGE, cards: [] };
  return <DeckEditor initial={initial} initialGroupBy={saved && isGroupBy(saved.groupBy) ? saved.groupBy : DEFAULT_GROUPING} />;
}

/** Loads the deck (if editing one), then hands it to the editor once. */
export function Editor({ id }: { id?: string }) {
  const saved = useQuery(api.decks.get, id ? { id } : "skip");
  if (id && saved === undefined) return <Loading text="Opening the deck…" />;
  if (id && saved === null) {
    return (
      <>
        <p className="form-error">Deck not found.</p>
        <a href="#/decks" className="link">← Back to decks</a>
      </>
    );
  }
  const initial: Draft = saved ? { id: saved._id, name: saved.name, format: saved.format, cards: saved.cards, extraColor: saved.extraColor, bracket: saved.bracket, bracketTags: saved.bracketTags } : { name: UNTITLED, format: "commander", cards: [] };
  return <DeckEditor initial={initial} initialGroupBy={saved && isGroupBy(saved.groupBy) ? saved.groupBy : DEFAULT_GROUPING} />;
}

function DeckEditor({ initial, initialGroupBy }: { initial: Draft; initialGroupBy: GroupBy }) {
  const { query } = useRoute();
  const [deck, setDeck] = useState<Draft>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedOnce, setSavedOnce] = useState(!!initial.id);
  const [missing, setMissing] = useState<string[]>([]);
  /** The last lookup didn't get through: cards without data aren't on their way. */
  const [lookupFailed, setLookupFailed] = useState(false);
  // A deck whose cards aren't cached waits on Scryfall (a second or more): show a loading screen
  // until they're in rather than a list that fills in piece by piece.
  const [loadingCards, setLoadingCards] = useState(() => initial.cards.some((c) => !scry.cachedExact(c) && !scry.cached(c)));
  const [, setCardData] = useState(0); // bumped when Scryfall data arrives, to re-render
  const [tab, setTab] = useState<"search" | "import" | "packages">(query.has("import") ? "import" : "search");
  // The open search is in the URL (#/decks/<id>?q=…), so a reload or a shared link reopens it.
  const [searchQuery, setSearchQuery] = useState<string | null>(() => query.get("q") || null);
  const searchRef = useRef(searchQuery);
  /** The deck drawer at the bottom of the search results: open or just its bar. */
  const [deckOpen, setDeckOpen] = useState(false);
  searchRef.current = searchQuery;
  const [addTo, setAddTo] = useState<Board>("main");
  const pref = usePrintingPref();
  const [repicking, setRepicking] = useState(false);

  const isPackage = initial.format === PACKAGE;
  const plain = isPlainList(deck.format);
  const noun = nounOf(deck.format);
  const home = isPackage ? "/decks/packages" : "/decks";
  const homeLabel = isPackage ? "Your packages" : "Your decks";
  /** Where picked names go: a plain list has only the one board. */
  const addBoard: Board = plain ? "main" : addTo;
  const store = useStore(isPackage);
  const createPackage = useMutation(api.packages.create);
  const importFromUrl = useAction(api.importDeck.fromUrl);
  const addTokenArt = useMutation(api.decks.addTokenArt);
  // How this deck is grouped is remembered with it (for a new deck, once it's created).
  const [groupBy, setGroupByState] = useState<GroupBy>(initialGroupBy);
  const groupByRef = useRef(groupBy);
  const rememberGroupBy = (id: string) =>
    store.setGroupBy(id, groupByRef.current).catch((e) => toast(`Couldn't remember how this ${noun} is grouped: ${errorMessage(e)}`, "error"));
  const setGroupBy = (by: GroupBy) => {
    groupByRef.current = by;
    setGroupByState(by);
    if (idRef.current) void rememberGroupBy(idRef.current);
  };
  // Token art from an import into a deck that isn't saved yet: stored once it's created.
  const pendingTokenArt = useRef<TokenPick[]>([]);

  // ---- Autosave ----
  // Every change bumps `version` and marks the deck dirty; a save runs ~0.8 s after the last change.
  // Saves never overlap: a change during a save queues one more save, so a new deck is only ever
  // created once. Leaving the page saves pending changes right away.
  const deckRef = useRef(deck);
  deckRef.current = deck;
  const version = useRef(0);
  const idRef = useRef<string | undefined>(initial.id);
  const inFlight = useRef(false);
  const again = useRef(false);
  const deleted = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      dismissToastAction();
    };
  }, []);

  const firstSearch = useRef(true);
  useEffect(() => {
    if (firstSearch.current) return void (firstSearch.current = false); // the URL already says it
    if (deleted.current) return;
    replaceQuietly(editorPath(initial.format, idRef.current, searchQuery));
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
      toast(`Couldn't load card data from Scryfall: ${scry.lookupError(e)}`, "error");
      setLookupFailed(true);
      return;
    }
    setMissing(notFound);
    setLookupFailed(false);
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
  async function addCard(c: scry.ScryCard, to: Board, exact = false, copies = 1) {
    const board: Board = isPlainList(deckRef.current.format) ? "main" : to;
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
      await addCard(await scry.named(name), addBoard);
    } catch (e) {
      toast(`Couldn't find ${name}: ${errorMessage(e)}`, "error");
    }
  }

  /** A card dragged in from EDHREC, Scryfall or the search results, dropped on `board`. */
  async function addDropped(d: DroppedCard, board: Board) {
    const tries: (() => Promise<scry.ScryCard>)[] = [];
    if (d.id) tries.push(() => scry.byScryfallId(d.id!));
    if (d.set && d.collectorNumber) tries.push(() => scry.printing(d.set!, d.collectorNumber!));
    if (d.name) tries.push(() => scry.named(d.name!), () => scry.fuzzyNamed(d.name!));
    if (d.fuzzy) tries.push(() => scry.fuzzyNamed(d.fuzzy!));
    for (const t of tries) {
      let c: scry.ScryCard;
      try {
        c = await t();
      } catch {
        continue;
      }
      // From another deck: the same printing and number of copies.
      await addCard(c, board, d.exact && c.id === d.id, d.quantity ?? 1);
      setCardData((n) => n + 1);
      return;
    }
    toast(`Couldn't find ${d.name ?? d.fuzzy ?? "that card"} on Scryfall`, "error");
  }

  /**
   * Several cards dragged from another deck: looked up together, then added in one go, each with its
   * printing and number of copies.
   */
  async function addDroppedMany(ds: DroppedCard[], to: Board) {
    const board: Board = isPlainList(deckRef.current.format) ? "main" : to;
    const asked: DeckCard[] = ds.map((d) => ({ name: d.name ?? "", quantity: d.quantity ?? 1, board, scryfallId: d.id, set: d.set, collectorNumber: d.collectorNumber }));
    try {
      await scry.resolve(asked);
    } catch (e) {
      return toast(`Couldn't load card data from Scryfall: ${scry.lookupError(e)}`, "error");
    }
    const found = asked.flatMap((c) => {
      const exact = scry.cachedExact(c);
      const s = exact ?? scry.cached(c);
      if (!s) return [];
      const print = exact ?? s;
      return [{ name: scry.deckName(s), quantity: c.quantity, board, scryfallId: print.id, set: print.set, collectorNumber: print.collector_number }];
    });
    const lost = asked.length - found.length;
    if (found.length) {
      change((d) => {
        for (const f of found) {
          const existing = d.cards.find((x) => x.board === board && x.name.toLowerCase() === f.name.toLowerCase());
          if (existing) existing.quantity = Math.min(MAX_QUANTITY, existing.quantity + f.quantity);
          else d.cards.push({ ...f, quantity: Math.min(MAX_QUANTITY, f.quantity) });
        }
        return d;
      });
      setCardData((n) => n + 1);
      toast(`Added ${found.length} cards${board === "main" ? "" : " to " + BOARDS.find((b) => b.id === board)!.label.toLowerCase()}${lost ? ` (${lost} not found on Scryfall)` : ""}`);
    } else toast("Couldn't find those cards on Scryfall", "error");
  }

  const dropTo = useCardDrops((ds, b) => void (ds.length === 1 ? addDropped(ds[0], b) : addDroppedMany(ds, b)));

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

  /** Puts a card in a category of your choosing (undefined: back to the automatic one). */
  function setCategory(target: DeckCard, category: string | undefined) {
    change((d) => {
      const i = entryIndex(d.cards, target);
      if (i < 0) return d;
      const clean = cleanCategory(category);
      if (clean) d.cards[i].category = clean;
      else delete d.cards[i].category;
      return d;
    });
  }

  function moveCard(target: DeckCard, board: Board) {
    moveCards([target], board);
  }

  /** Moves deck entries to another board, joining copies already there. */
  function moveCards(targets: DeckCard[], board: Board) {
    change((d) => {
      for (const t of targets) {
        const i = entryIndex(d.cards, t);
        if (i >= 0) d.cards[i].board = board;
      }
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

  /** Adds a package's cards (each with how many copies), and offers to take them out again. */
  function addPackage(entries: PackageEntry[], to: Board, packageName: string, tag?: string) {
    const board: Board = isPlainList(deckRef.current.format) ? "main" : to;
    const added = entries.flatMap((e) => {
      const s = scry.cachedExact(e.card) ?? scry.cached(e.card);
      const print = e.card.scryfallId || !s ? {} : { scryfallId: s.id, set: s.set, collectorNumber: s.collector_number };
      const tags = cleanCardTags([...(e.card.tags ?? []), ...(tag ? [tag] : [])]);
      const { tags: _, ...card } = e.card;
      return e.copies > 0 ? [{ ...card, ...print, ...(tags.length ? { tags } : {}), name: s ? scry.deckName(s) : card.name, quantity: e.copies, board }] : [];
    });
    if (!added.length) return;
    const same = (a: DeckCard, b: DeckCard) => a.board === b.board && cardKey(a.name) === cardKey(b.name);
    change((d) => {
      for (const a of added) {
        const there = d.cards.find((c) => same(c, a));
        if (!there) d.cards.push({ ...a });
        else {
          // A card that's there already keeps its own printing, category and tags.
          there.quantity = Math.min(MAX_QUANTITY, there.quantity + a.quantity);
          if (tag) there.tags = cleanCardTags([...(there.tags ?? []), tag]);
        }
      }
      return d;
    });
    const n = copiesIn(entries);
    toast(`Added ${n} card${n === 1 ? "" : "s"} from ${packageName}`, "info", {
      label: "Undo",
      run: () => {
        if (!mounted.current) return;
        change((d) => ({
          ...d,
          cards: d.cards.flatMap((c) => {
            const a = added.find((x) => same(x, c));
            if (!a) return [c];
            return c.quantity > a.quantity ? [{ ...c, quantity: c.quantity - a.quantity }] : [];
          }),
        }));
      },
    });
  }

  /** A new package of the deck's main board, without its basic lands (and without its commander). */
  async function saveAsPackage() {
    const cards = mergeDuplicates(
      deck.cards
        .filter((c) => c.board === "main" && !/^Basic\b/.test(scry.cached(c)?.type_line ?? ""))
        .map((c) => ({ ...c, board: "main" as const })),
    );
    if (!cards.length) return toast("There are no cards to put in a package yet.", "error");
    try {
      const id = await createPackage({ name: deck.name.slice(0, MAX_PACKAGE_NAME), cards });
      toast(`Saved ${cards.length} cards as a package`, "info", { label: "Open it", run: () => navigate(`/decks/packages/${id}`) });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function applyImport(imported: DeckCard[], replace: boolean, name?: string, format?: string, tokens: ParsedToken[] = []) {
    const cards = plain ? imported.map((c) => ({ ...c, board: "main" as const })) : imported;
    const merged = mergeDuplicates(replace ? cards : [...deck.cards, ...cards]);
    change((d) => ({
      ...d,
      cards: merged,
      name: name && (replace || UNTITLED_NAMES.includes(d.name)) ? name.slice(0, isPackage ? MAX_PACKAGE_NAME : 100) : d.name,
      format: format && FORMATS.includes(format) && replace && !isPlainList(d.format) ? format : d.format,
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
    if (!known.length || isPackage) return;
    const asCards: DeckCard[] = known.map((t) => ({ name: t.name, quantity: 1, board: "main", scryfallId: t.scryfallId, set: t.set, collectorNumber: t.collectorNumber }));
    try {
      await scry.resolve(asCards);
      const picks = tokenPicks(asCards.map((c) => (c.scryfallId ? scry.cachedById(c.scryfallId) : scry.cachedPrinting(c.set!, c.collectorNumber!))));
      if (!picks.length) return;
      if (idRef.current) await addTokenArt({ id: idRef.current as Id<"decks">, picks });
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
      setSaveError(`give the ${noun} a name`);
      return;
    }
    inFlight.current = true;
    setSaving(true);
    const savingVersion = version.current;
    try {
      if (idRef.current) await store.update(idRef.current, d);
      else {
        const id = await store.create(d);
        idRef.current = id;
        if (groupByRef.current !== DEFAULT_GROUPING) void rememberGroupBy(id);
        if (pendingTokenArt.current.length) {
          const picks = pendingTokenArt.current;
          pendingTokenArt.current = [];
          addTokenArt({ id: id as Id<"decks">, picks }).catch((e) => toast(`Couldn't save the deck's token art: ${errorMessage(e)}`, "error"));
        }
        setDeck((x) => ({ ...x, id }));
        replaceQuietly(editorPath(initial.format, id, searchRef.current));
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
    return confirm(`This ${noun} couldn't be saved (${saveErrorRef.current}). Leave anyway?`);
  }, [noun]);
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
      setTimeout(() => navigate(home));
      return;
    }
    if (!confirm(`Delete "${deck.name}"? This can't be undone.`)) return;
    try {
      deleted.current = true;
      await store.remove(id);
      setDirty(false);
      toast(`${noun.charAt(0).toUpperCase() + noun.slice(1)} deleted`);
      setTimeout(() => navigate(home));
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
        <a href={`#${home}`} className="back link">← {homeLabel}</a>
        <div className="spinner" aria-hidden="true" />
        <h2>{deck.name}</h2>
        <p><ScryfallWaiting text={`Loading ${count} cards from Scryfall…`} still={`Still loading ${count} cards.`} /></p>
      </div>
    );
  }

  const deckView = (
    <DeckView
      deck={deck}
      missing={missing}
      lookupFailed={lookupFailed}
      count={count}
      onQty={setQty}
      onMove={moveCard}
      onMoveMany={moveCards}
      onRestore={(cards) => change((d) => ({ ...d, cards: mergeDuplicates([...d.cards, ...cards.map((c) => ({ ...c }))]) }))}
      onTags={setTags}
      onCategory={setCategory}
      groupBy={groupBy}
      onGroupBy={setGroupBy}
      onMakeCommander={makeCommander}
      onPrinting={setPrinting}
      onAddCommander={(c) => void addCard(c, "commander")}
      dropTo={dropTo && plain ? "main" : dropTo}
      onExtraColor={(c) => change((d) => ({ ...d, extraColor: c }))}
      onBracket={(b) => change((d) => ({ ...d, bracket: b }))}
      onBracketTags={(t) => change((d) => ({ ...d, bracketTags: t.length ? t : undefined }))}
    />
  );

  return (
    <div className="editor">
      <div className="editor-head">
        {/* While searching, the search page's own "Back to deck" is the way back; this one, to the deck list, steps aside. */}
        <a href={`#${home}`} className={`back${searchQuery !== null ? " minor" : ""}`} title={`Back to ${homeLabel.toLowerCase()}`}>{searchQuery !== null ? `← ${homeLabel}` : "←"}</a>
        <input className="deck-name" value={deck.name} maxLength={isPackage ? MAX_PACKAGE_NAME : 100} aria-label={`${noun.charAt(0).toUpperCase() + noun.slice(1)} name`} onChange={(e) => change((d) => ({ ...d, name: e.target.value }))} />
        {isPackage ? (
          <input className="package-note" value={deck.note ?? ""} maxLength={MAX_PACKAGE_NOTE} aria-label="Note" placeholder="What it's for (optional)" onChange={(e) => change((d) => ({ ...d, note: e.target.value }))} />
        ) : (
          <>
            <select aria-label="Format" value={deck.format} onChange={(e) => change((d) => ({ ...d, format: e.target.value }))}>
              {FORMATS.map((f) => <option key={f} value={f}>{formatLabel(f)}</option>)}
            </select>
            <FolderSelect deckId={deck.id as Id<"decks"> | undefined} />
          </>
        )}
        <span className="count-badge" data-ok={String(badgeOk)}>{badge}</span>
        <div className="spacer" />
        <span className={`save-state small ${saveError ? "error" : "muted"}`} role="status">{saving && <Spinner />} {saveState}</span>
        <details className="menu">
          <summary className="btn ghost">Export</summary>
          <div className="menu-list" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute("open")}>
            <button onClick={() => void copyList()}>Copy decklist</button>
            <button onClick={downloadList}>Download .txt</button>
            {!isPackage && <button onClick={() => void saveAsPackage()}>Save as a package</button>}
          </div>
        </details>
        <details className="menu">
          <summary className="btn ghost" title={`Change the printing of every card in the ${noun}`}><BusyLabel busy={repicking} working="Finding…">Printings</BusyLabel></summary>
          <div className="menu-list" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute("open")}>
            {[pref, ...PRINTING_PREFS.map((x) => x.id).filter((x) => x !== pref)].map((x) => (
              <button key={x} disabled={repicking || !deck.cards.length} title={PRINTING_PREFS.find((y) => y.id === x)!.hint} onClick={() => void setAllPrintings(x)}>
                All cards: {prefLabel(x)}{x === pref ? " (your default)" : ""}
              </button>
            ))}
          </div>
        </details>
        <button className="btn ghost danger" onClick={() => void remove()} title={`Delete ${noun}`}>Delete</button>
      </div>
      {searchQuery !== null ? (
        <SearchResults
          query={searchQuery}
          format={deck.format}
          deck={deck.cards}
          commanders={commanders}
          extraColor={deck.extraColor}
          defaultBoard={addBoard}
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
                {!isPackage && <button className={`tab${tab === "packages" ? " active" : ""}`} onClick={() => setTab("packages")}>Packages</button>}
            </div>
            <SearchPane hidden={tab !== "search"} boards={boardsFor(deck.format)} addTo={addBoard} onAddTo={setAddTo} onPick={(n) => void addByName(n)} onSubmit={setSearchQuery} autoFocus={!deck.cards.length && tab === "search"} identity={identityFilter(deck.format, deck.cards, commanders, deck.extraColor)} />
            <ImportPane hidden={tab !== "import"} startReplacing={deck.cards.length === 0} onImport={applyImport} importFromUrl={(url) => importFromUrl({ url })} autoFocus={tab === "import"} />
            {tab === "packages" && <PackagesPane hidden={false} deck={deck} onAdd={addPackage} />}
          </aside>
          {deckView}
        </div>
      )}
      {searchQuery === null && deck.cards.length > 0 && (
        <DeckBar cards={deck.cards} count={badge} countOk={badgeOk} bracket={deck.bracket} commander={deck.format === "commander"} />
      )}
      {searchQuery !== null && (
        <DeckDrawer open={deckOpen} onToggle={() => setDeckOpen((o) => !o)} name={deck.name} badge={badge} badgeOk={badgeOk} side={deck.cards.length > 0 && <DeckTypeCounts cards={deck.cards} className="in-drawer" />}>
          {deckView}
        </DeckDrawer>
      )}
    </div>
  );
}

// ---- Search ---------------------------------------------------------------------------

function SearchPane(props: { hidden: boolean; boards: typeof BOARDS; addTo: Board; onAddTo: (b: Board) => void; onPick: (name: string) => void; onSubmit: (q: string) => void; autoFocus: boolean; identity: ReturnType<typeof identityFilter> }) {
  return (
    <div className="pane" hidden={props.hidden}>
      <SearchBox onPick={props.onPick} onSubmit={props.onSubmit} autoFocus={props.autoFocus} identity={props.identity} />
      <div className="search-help">
        {props.boards.length > 1 && <label className="inline small muted">
          Picked names go to{" "}
          <select aria-label="Add cards to" value={props.addTo} onChange={(e) => props.onAddTo(e.target.value as Board)}>
            {props.boards.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </label>}
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
  /** Which import is running. */
  const [busy, setBusy] = useState<"link" | "text" | "file" | null>(null);

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
    setBusy("link");
    try {
      const d = await props.importFromUrl(url.trim());
      await props.onImport(d.cards, replace, d.name, d.format, d.tokens);
      setReplace(false);
      setUrl("");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function fromText() {
    setBusy("text");
    try {
      await fromParsed(parseDecklist(text));
      setText("");
    } finally {
      setBusy(null);
    }
  }

  async function fromFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 1_000_000) return toast("That file is too big for a decklist.", "error");
    setBusy("file");
    try {
      await fromParsed(parseDecklist(await f.text()), f.name.replace(/\.[^.]+$/, ""));
    } finally {
      setBusy(null);
    }
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
          <button className="btn" disabled={!!busy} onClick={() => void fromLink()}><BusyLabel busy={busy === "link"} working="Importing…">Import link</BusyLabel></button>
        </div>
      </section>
      <section className="import-block">
        <h3>Paste a list</h3>
        <p className="muted small">Moxfield, Archidekt, Arena or MTGO text exports. One card per line.</p>
        <textarea rows={8} aria-label="Decklist text" placeholder={"Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Sol Ring\n1 Arcane Signet\n…"} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn" disabled={!!busy} onClick={() => void fromText()}><BusyLabel busy={busy === "text"} working="Importing…">Import text</BusyLabel></button>
      </section>
      <section className="import-block">
        <h3>Upload a file</h3>
        <p className="muted small">.txt or .dek decklist.</p>
        <input type="file" accept=".txt,.dek,.dec,.csv,text/plain" aria-label="Decklist file" onChange={(e) => void fromFile(e.target.files?.[0]).then(() => (e.target.value = ""))} />
      </section>
    </div>
  );
}

// ---- Cards dragged in -------------------------------------------------------------------

/** A drag that started on this page (a card's image, a link): not a card coming in. */
let dragFromPage = false;
window.addEventListener("dragstart", () => (dragFromPage = true), true);
window.addEventListener("dragend", () => (dragFromPage = false), true);
// dragend never comes when the dragged element went away mid-drag; the pointer moving again
// (it doesn't during a drag) means the drag is over.
window.addEventListener("pointermove", () => (dragFromPage = false), true);

/** Text boxes keep their usual drop (the text goes in). */
const isTextBox = (t: EventTarget | null) => t instanceof HTMLElement && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable);

/**
 * Where a drop at `target` (height `y`) goes: the sideboard or Considering when on them, Considering
 * when below the main deck, otherwise (anywhere else on the page too) the main deck.
 */
function dropBoardAt(target: EventTarget | null, y: number): Board {
  const el = target instanceof Element ? target : null;
  const b = el?.closest<HTMLElement>("[data-board]")?.dataset.board;
  if (b === "side" || b === "maybe") return b;
  if (b) return "main";
  const main = el?.closest(".deck-view")?.querySelector('[data-board="main"], [data-board="deck"]');
  return main && y > main.getBoundingClientRect().bottom ? "maybe" : "main";
}

/**
 * Cards dragged onto the editor from another site (EDHREC, Scryfall) or the search results. The
 * whole page takes the drop, so the browser never opens the dragged link instead. Returns the
 * board the card would land on while one is dragged over, else null.
 */
function useCardDrops(onDrop: (d: DroppedCard[], board: Board) => void): Board | null {
  const [dropTo, setDropTo] = useState<Board | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  useEffect(() => {
    const incoming = (e: DragEvent) => !dragFromPage && !!e.dataTransfer && looksLikeCard(e.dataTransfer.types) && !isTextBox(e.target);
    const over = (e: DragEvent) => {
      if (!incoming(e)) return setDropTo(null);
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
      setDropTo(dropBoardAt(e.target, e.clientY));
    };
    // Leaving the window: relatedTarget is null.
    const leave = (e: DragEvent) => void (e.relatedTarget === null && setDropTo(null));
    const drop = (e: DragEvent) => {
      setDropTo(null);
      if (!incoming(e)) return;
      e.preventDefault();
      const dt = e.dataTransfer!;
      const fromDeck = readDeckCards(dt.getData(CARD_TYPE));
      const d = fromDeck ? null : readDrop({ html: dt.getData("text/html"), uris: dt.getData("text/uri-list"), text: dt.getData("text/plain") }, (h) => new DOMParser().parseFromString(h, "text/html"));
      const cards = fromDeck ?? (d ? [d] : null);
      if (cards) onDropRef.current(cards, dropBoardAt(e.target, e.clientY));
      else toast("That doesn't look like a card", "error");
    };
    // Safari wants dragenter turned down too before it allows the drop.
    window.addEventListener("dragenter", over);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", over);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);
  return dropTo;
}

// ---- The deck -------------------------------------------------------------------------

/** Where pressing doesn't start drag select: cards, things you click, type in or drag, menus, dialogs and bars. */
const NO_MARQUEE = [
  "[data-sel]", "button", "a", "input", "select", "textarea", "label", "summary", "details", "dialog", "img", "svg", "video",
  "[draggable='true']", "[contenteditable]", "[role='menu']", "[role='slider']", ".card-menu", ".sel-bar", ".partner-slot", ".deck-bar", ".deck-drawer-bar", "#toast",
].join(", ");

/** The press is on a scrollbar (the page's or a scrolling box's), which drags to scroll. */
function onScrollbar(t: Element, e: PointerEvent): boolean {
  if (e.clientX >= document.documentElement.clientWidth || e.clientY >= document.documentElement.clientHeight) return true;
  if (t === document.documentElement || t === document.body) return false;
  // Only boxes that scroll have scrollbars (an inline element's clientWidth is 0).
  if (!t.clientWidth || (t.scrollHeight <= t.clientHeight && t.scrollWidth <= t.clientWidth)) return false;
  const r = t.getBoundingClientRect();
  return e.clientX > r.left + t.clientLeft + t.clientWidth || e.clientY > r.top + t.clientTop + t.clientHeight;
}

/** A deck entry's id for the selection: its board and name (as the editor finds entries). */
const selId = (c: DeckCard) => `${c.board}|${c.name}`;

/** "Sol Ring, Arcane Signet and 3 more · Main deck": under the title of the selection's menu. */
function selectionSummary(cards: DeckCard[], format: string): string {
  const names = cards.slice(0, 3).map((c) => c.name).join(", ") + (cards.length > 3 ? ` and ${cards.length - 3} more` : "");
  const boards = [...new Set(cards.map((c) => c.board))];
  return `${names} · ${boards.length === 1 ? boardLabel(boards[0], format) : `${boards.length} boards`}`;
}

/** The picture under the pointer while several cards are dragged: up to three of them fanned, and how many. */
function dragPile(dt: DataTransfer, cards: DeckCard[]) {
  const pile = document.createElement("div");
  pile.className = "drag-pile";
  cards.slice(0, 3).reverse().forEach((c, i, top) => {
    const s = scry.cached(c);
    const url = s && scry.imageUrl(s, "normal", 0); // already loaded for the deck, so it shows in the picture
    const el = url ? Object.assign(document.createElement("img"), { src: url, alt: "" }) : Object.assign(document.createElement("div"), { className: "drag-blank" });
    const n = top.length - 1 - i; // 0 for the card on top
    Object.assign(el.style, { left: `${8 - n * 6}px`, top: `${16 + n * 4}px`, transform: `rotate(${-n * 5}deg)` });
    pile.append(el);
  });
  const count = document.createElement("span");
  count.className = "drag-count";
  count.textContent = String(cards.length);
  pile.append(count);
  document.body.append(pile);
  dt.setDragImage(pile, 60, 60);
  // The browser takes its picture of the pile now; it can go once the drag has started.
  setTimeout(() => pile.remove());
}

function DeckView(props: {
  deck: Draft;
  missing: string[];
  lookupFailed: boolean;
  count: (b?: Board) => number;
  onQty: (c: DeckCard, q: number) => void;
  onMove: (c: DeckCard, b: Board) => void;
  /** Several cards at once (the selection). */
  onMoveMany: (cards: DeckCard[], b: Board) => void;
  /** Puts removed cards back (Undo). */
  onRestore: (cards: DeckCard[]) => void;
  onTags: (c: DeckCard, tags: string[]) => void;
  onCategory: (c: DeckCard, category: string | undefined) => void;
  groupBy: GroupBy;
  onGroupBy: (by: GroupBy) => void;
  onMakeCommander: (c: DeckCard, partner: boolean) => void;
  onPrinting: (c: DeckCard, p: scry.ScryCard) => void;
  onAddCommander: (c: scry.ScryCard) => void;
  /** Where a card being dragged in would go (useCardDrops); null when nothing is. */
  dropTo: Board | null;
  onExtraColor: (color: string | undefined) => void;
  onBracket: (b: number | undefined) => void;
  onBracketTags: (tags: string[]) => void;
}) {
  const { deck, missing, lookupFailed, count } = props;
  /** "GC" on Game Changers in Commander decks (Commander Brackets). */
  const gameChanger = (s: scry.ScryCard | undefined, className: string) =>
    deck.format === "commander" && s?.game_changer ? <span className={className} title="Game Changer: Exhibition and Core decks allow none, Upgraded up to 3">GC</span> : null;
  const noun = nounOf(deck.format);
  /** The cards being added to a package, or to another deck. */
  const [packaging, setPackaging] = useState<DeckCard[] | null>(null);
  const [copyingTo, setCopyingTo] = useState<DeckCard[] | null>(null);
  const preview = useCardPreview();
  const flips = useFlips();
  const [printingsFor, setPrintingsFor] = useState<DeckCard | null>(null);
  const [pickingPartner, setPickingPartner] = useState(false);
  /** The right-clicked card's menu: where it opened and which entry (by `key`), rebuilt each render; `multi` for the selection's menu. */
  const [menu, setMenu] = useState<{ x: number; y: number; key: string; multi?: boolean } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [view, setView] = useCardView();
  const stacked = view === "stacked" || view === "spread";
  const { groupBy } = props;
  const categories = useCardCategories(groupBy === "category");
  /** Undefined while the automatic categories load; without them, cards go by type. */
  const auto: AutoCategories | undefined = categories === undefined ? undefined : (s) => categories?.of(s.oracle_id ?? s.card_faces?.[0]?.oracle_id) ?? [];
  /** The cards whose tags are being edited (by `selId`, so they survive edits). */
  const [tagging, setTagging] = useState<string[] | null>(null);
  /** The cards whose category is being chosen. */
  const [categorizing, setCategorizing] = useState<string[] | null>(null);
  const [measure, stackCols] = useStackColumns();
  const support = useCardSupport();

  const { dropTo } = props;

  // ---- Selection: drag a box over the cards, or Ctrl/⌘-click them ----
  /** The selected entries, by `selId`. Entries that left the deck simply aren't found. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const selectedCards = deck.cards.filter((c) => selected.has(selId(c)));
  /** The card under the pointer, for the shortcuts when nothing is selected. */
  const hovered = useRef<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const [band, setBand] = useState<Box | null>(null);
  const toggle = (c: DeckCard) =>
    setSelected((was) => {
      const next = new Set(was);
      if (!next.delete(selId(c))) next.add(selId(c));
      return next;
    });

  /**
   * Pressing on empty space anywhere on the page (beside the deck too) and dragging draws a box; the
   * cards whose visible part it touches are selected (src/marquee.ts). Shift or Ctrl/⌘ adds to
   * what's selected. A click on empty space clears the selection. On the search page, only inside
   * the deck drawer.
   */
  const startMarquee = (e: PointerEvent) => {
    const el = root.current;
    const t = e.target instanceof Element ? e.target : null;
    if (!el || !t || e.button !== 0 || e.pointerType !== "mouse" || !el.getClientRects().length) return;
    const drawer = el.closest(".deck-drawer-body");
    if (drawer && !drawer.contains(t)) return;
    if (t.closest(NO_MARQUEE) || onScrollbar(t, e)) return;
    const r0 = el.getBoundingClientRect();
    // Kept relative to the deck, so it stays put if the page (or the drawer) scrolls during the drag.
    const sx = e.clientX - r0.left;
    const sy = e.clientY - r0.top;
    const base = e.shiftKey || e.ctrlKey || e.metaKey ? new Set(selected) : new Set<string>();
    let moved = false;
    document.body.classList.add("marquee-armed");
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x0 = sx + r.left;
      const y0 = sy + r.top;
      if (!moved && Math.abs(ev.clientX - x0) < 5 && Math.abs(ev.clientY - y0) < 5) return;
      if (!moved) {
        moved = true;
        document.body.classList.add("marqueeing");
        preview.hide();
      }
      window.getSelection()?.removeAllRanges();
      // Near the top or bottom of the window, the page scrolls along.
      if (ev.clientY > innerHeight - 30) scrollBy(0, 24);
      else if (ev.clientY < 30) scrollBy(0, -24);
      const box = boxBetween(x0, y0, ev.clientX, ev.clientY);
      const cards = [...el.querySelectorAll<HTMLElement>("[data-sel]")];
      const hit = caught(box, visibleParts(cards.map((c) => c.getBoundingClientRect())));
      setSelected(new Set([...base, ...hit.map((i) => cards[i].dataset.sel!)]));
      setBand(box);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.body.classList.remove("marquee-armed", "marqueeing");
      setBand(null);
      if (!moved && !base.size) setSelected(new Set());
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  /** Ctrl/⌘-click (or Shift-click) a card to add it to the selection or take it out. */
  const toggleOnClick = (c: DeckCard) => (e: React.MouseEvent) => {
    if (!(e.ctrlKey || e.metaKey || e.shiftKey) || (e.target as Element).closest("input, .qty, .menu-btn")) return;
    e.preventDefault();
    e.stopPropagation();
    toggle(c);
  };

  /** What the shortcuts and the selection's menu act on: the selection, else the card under the pointer. */
  const targets = (): DeckCard[] => {
    if (selectedCards.length) return selectedCards;
    const c = hovered.current && deck.cards.find((x) => selId(x) === hovered.current);
    return c ? [c] : [];
  };
  const named = (cards: DeckCard[]) => (cards.length === 1 ? cards[0].name : `${cards.length} cards`);
  const canMoveTo = (b: Board) => boardsFor(deck.format).some((x) => x.id === b) && b !== "commander";

  const addEach = (cards: DeckCard[], n: number) => {
    for (const c of cards) props.onQty(c, Math.min(MAX_QUANTITY, c.quantity + n));
    toast(cards.length === 1 ? `Added ${n > 1 ? `${n} × ` : "one "}${cards[0].name}` : `Added ${n > 1 ? n : "one"} of each of ${cards.length} cards`);
  };
  const removeEach = (cards: DeckCard[]) => {
    for (const c of cards) props.onQty(c, c.quantity - 1);
    // Undo puts back the entries that ran out and the copies of the others.
    const undo = () => {
      props.onRestore(cards.filter((c) => c.quantity <= 1));
      for (const c of cards) if (c.quantity > 1) props.onQty(c, c.quantity);
    };
    toast(cards.length === 1 ? `Removed one ${cards[0].name}` : `Removed one of each of ${cards.length} cards`, "info", { label: "Undo", run: undo });
  };
  const removeAll = (cards: DeckCard[]) => {
    for (const c of cards) props.onQty(c, 0);
    setSelected(new Set());
    toast(`Removed ${named(cards)}`, "info", { label: "Undo", run: () => props.onRestore(cards) });
  };
  const moveAll = (cards: DeckCard[], b: Board) => {
    const moving = cards.filter((c) => c.board !== b);
    if (!moving.length || !canMoveTo(b)) return;
    props.onMoveMany(moving, b);
    // The selection follows the cards to their new board.
    setSelected((was) => (was.size ? new Set([...was].map((k) => (moving.some((c) => selId(c) === k) ? `${b}|${k.split("|").slice(1).join("|")}` : k))) : was));
    toast(`Moved ${named(moving)} to ${boardLabel(b, deck.format).toLowerCase()}`);
  };
  const copyList = (cards: DeckCard[]) =>
    void navigator.clipboard.writeText(cardLines(cards)).then(
      () => toast(`Copied ${named(cards)}`),
      () => toast("Couldn't copy to the clipboard", "error"),
    );

  const runShortcut = (k: DeckShortcut, cards: DeckCard[]) => {
    if (!cards.length) return;
    if (k === "addOne") addEach(cards, 1);
    else if (k === "removeOne") removeEach(cards);
    else if (k === "toSide") moveAll(cards, "side");
    else if (k === "toMaybe") moveAll(cards, "maybe");
    else if (k === "toMain") moveAll(cards, "main");
    else if (k === "tags") setTagging(cards.map(selId));
  };

  // The keys: Alt+1–5 and Alt+T on the selection or the card under the pointer, Escape clears the
  // selection, Ctrl/⌘+A selects every card, Ctrl/⌘+C copies the selected ones. Not while typing, in
  // a dialog, or when the deck isn't showing (the search page with its drawer closed).
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (e.defaultPrevented || isTextBox(e.target) || document.querySelector("dialog[open]") || !root.current?.getClientRects().length) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Escape" && selected.size && !document.querySelector(".card-menu")) {
      setSelected(new Set());
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && e.code === "KeyA" && deck.cards.length) {
      e.preventDefault();
      setSelected(new Set(deck.cards.map(selId)));
      return;
    }
    if (mod && !e.altKey && e.code === "KeyC" && selectedCards.length && (window.getSelection()?.isCollapsed ?? true)) {
      e.preventDefault();
      copyList(selectedCards);
      return;
    }
    const k = deckShortcut(e);
    if (!k) return;
    e.preventDefault();
    runShortcut(k, targets());
  };
  const marquee = useRef(startMarquee);
  marquee.current = startMarquee;
  useEffect(() => {
    const onDown = (e: PointerEvent) => marquee.current(e);
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      <section className={`panel deck-view${dropTo ? " dropping" : ""}`}>
        <div className="empty">
          <h3>This {noun} is empty</h3>
          <p>Search for cards on the left, switch to Import to bring in a list{deck.format === PACKAGE ? "" : ", add a package"}, or drag cards in from EDHREC.</p>
        </div>
      </section>
    );
  }

  /**
   * Where a card can go from its board: the other boards, and in Commander-style decks "Make
   * commander" (and "Add as second commander" next to a partner) for a card that can lead the deck,
   * which then replaces a plain move to Commander.
   */
  const destinations = (c: DeckCard, s: scry.ScryCard | undefined) => {
    const cmdrs = deck.cards.filter((x) => x.board === "commander");
    const cmdrCards = cmdrs.map((x) => scry.cached(x));
    const commanderFormat = deck.format === "commander" || deck.format === "conquest";
    const eligible = commanderFormat && c.board !== "commander" && !!s && canCommand(s, deck.format);
    const asPartner = eligible && cmdrs.length === 1 && !!cmdrCards[0] && canPair(cmdrCards[0], s!);
    const commander: { label: string; run: () => void }[] = !eligible
      ? []
      : [
          ...(asPartner ? [{ label: "★ Add as second commander", run: () => props.onMakeCommander(c, true) }] : []),
          { label: cmdrs.length ? (cmdrs.length > 1 ? "★ Make commander (replaces both)" : `★ Make commander (replaces ${cmdrs[0].name})`) : "★ Make commander", run: () => props.onMakeCommander(c, false) },
        ];
    const moves = boardsFor(deck.format).filter((b) => b.id !== c.board && !(b.id === "commander" && eligible)).map((b) => ({ board: b, run: () => props.onMove(c, b.id) }));
    return { commander, moves };
  };

  const openDetails = (c: DeckCard, s: scry.ScryCard) => {
    preview.hide();
    const { commander, moves } = destinations(c, s);
    showCardDetails(s, [
      ...moves.map((m) => ({ label: m.board.id === "commander" ? "Move to commander" : `Move to ${m.board.label.toLowerCase()}`, run: m.run })),
      ...commander,
      { label: "Choose printing…", run: () => setPrintingsFor(c) },
      ...(deck.format === PACKAGE ? [] : [{ label: "Add to package…", run: () => setPackaging([c]) }]),
      { label: "Add to another deck…", run: () => setCopyingTo([c]) },
      { label: "Add tags…", run: () => setTagging([selId(c)]) },
      ...(groupBy === "category" && c.board !== "commander" ? [{ label: "Choose category…", run: () => setCategorizing([selId(c)]) }] : []),
      { label: c.quantity > 1 ? `Remove all ${c.quantity}` : `Remove from ${noun}`, run: () => props.onQty(c, 0), danger: true },
    ]);
  };

  const qty = (c: DeckCard) => (
    <span className="qty">
      <button className="qbtn" aria-label="One fewer" onClick={() => props.onQty(c, c.quantity - 1)}>−</button>
      <QtyInput value={c.quantity} label={`Number of ${c.name}`} onChange={(n) => props.onQty(c, n)} />
      <button className="qbtn" aria-label="One more" onClick={() => props.onQty(c, c.quantity + 1)}>+</button>
    </span>
  );

  /** Grouped by category: the card's category, others it fits, and choosing any other. */
  const categorySection = (c: DeckCard, s: scry.ScryCard | undefined): MenuSection[] => {
    if (groupBy !== "category" || !auto || c.board === "commander") return [];
    const fits = fittingCategories(s, auto);
    const now = categoryOf(c, s, auto);
    const same = (a: string | undefined, b: string | undefined) => a?.toLowerCase() === b?.toLowerCase();
    const best = fits[0] ?? scry.primaryType(s);
    return [
      {
        title: `Category: ${now ?? scry.primaryType(s)}`,
        items: [
          ...fits.slice(1, 4).filter((f) => !same(f, now)).map((f) => ({ label: `Move to ${f}`, onSelect: () => props.onCategory(c, f) })),
          ...(c.category ? [{ label: `Automatic (${best})`, onSelect: () => props.onCategory(c, undefined) }] : []),
          { label: "Choose category…", onSelect: () => setCategorizing([selId(c)]) },
        ],
      },
    ];
  };

  /**
   * Every action for one deck entry. The same list opens from the "⋯" button and from a
   * right-click on the card (no native <select>).
   */
  const menuSections = (c: DeckCard, s: scry.ScryCard | undefined): MenuSection[] => {
    const { commander, moves } = destinations(c, s);
    const commanderItems: MenuItem[] = commander.map((x) => ({ label: x.label, onSelect: x.run }));
    const sections: MenuSection[] = [
      {
        title: `${c.quantity} × ${c.name} · ${boardLabel(c.board, deck.format)}`,
        items: [
          { label: "+ Add one", keepOpen: true, keys: DECK_SHORTCUTS.addOne, onSelect: () => props.onQty(c, c.quantity + 1) },
          { label: "− Remove one", keepOpen: c.quantity > 1, keys: DECK_SHORTCUTS.removeOne, onSelect: () => props.onQty(c, c.quantity - 1) },
          { label: "Add", onSelect: () => {}, amount: { initial: 1, min: 1, max: MAX_QUANTITY - c.quantity, button: "Add", onAmount: (n) => props.onQty(c, c.quantity + n) } },
          { label: "Set to", onSelect: () => {}, amount: { initial: c.quantity, min: 0, max: MAX_QUANTITY, button: "Set", onAmount: (n) => props.onQty(c, n) } },
        ],
      },
      {
        items: [
          { label: "Card details", disabled: !s, onSelect: () => s && openDetails(c, s) },
          { label: "Choose printing…", onSelect: () => setPrintingsFor(c) },
          { label: c.tags?.length ? `Tags: ${c.tags.join(", ")}` : "Add tags…", keys: DECK_SHORTCUTS.tags, onSelect: () => setTagging([selId(c)]) },
          ...(deck.format === PACKAGE ? [] : [{ label: "Add to package…", onSelect: () => setPackaging([c]) }]),
          { label: "Add to another deck…", onSelect: () => setCopyingTo([c]) },
        ],
      },
      ...categorySection(c, s),
      { items: commanderItems },
      {
        title: "Move to",
        items: moves.map((m) => ({ label: m.board.label, keys: moveKeys(m.board.id), onSelect: m.run })),
      },
      { items: [{ label: c.quantity > 1 ? `Remove all ${c.quantity}` : `Remove from ${noun}`, danger: true, onSelect: () => props.onQty(c, 0) }] },
    ];
    return sections.filter((sec) => sec.items.length);
  };

  /** The shortcut that moves cards to this board, if there is one. */
  const moveKeys = (b: Board) => (b === "side" ? DECK_SHORTCUTS.toSide : b === "maybe" ? DECK_SHORTCUTS.toMaybe : b === "main" ? DECK_SHORTCUTS.toMain : undefined);

  /** The menu for several selected cards: what can be done to all of them, in two columns. */
  const selectionSections = (cards: DeckCard[]): MenuSection[] => {
    const max = Math.min(...cards.map((c) => MAX_QUANTITY - c.quantity));
    const boards = boardsFor(deck.format).filter((b) => canMoveTo(b.id));
    return [
      {
        items: [
          { label: "Add one of each", keepOpen: true, keys: DECK_SHORTCUTS.addOne, onSelect: () => addEach(cards, 1) },
          ...(max >= 1 ? [{ label: "Add more of each", onSelect: () => {}, amount: { initial: 1, min: 1, max, button: "Add", onAmount: (n: number) => addEach(cards, n) } }] : []),
          { label: "Remove one of each", danger: true, keys: DECK_SHORTCUTS.removeOne, onSelect: () => removeEach(cards) },
          { label: "Remove all", danger: true, onSelect: () => removeAll(cards) },
        ],
      },
      ...(boards.length > 1
        ? [{ title: "Move to", items: boards.map((b) => ({ label: b.label, keys: moveKeys(b.id), disabled: cards.every((c) => c.board === b.id), onSelect: () => moveAll(cards, b.id) })) }]
        : []),
      {
        second: true,
        items: [
          { label: "Change tags…", keys: DECK_SHORTCUTS.tags, onSelect: () => setTagging(cards.map(selId)) },
          ...(groupBy === "category" ? [{ label: "Choose category…", onSelect: () => setCategorizing(cards.filter((c) => c.board !== "commander").map(selId)) }] : []),
        ],
      },
      {
        second: true,
        items: [
          { label: "Add to another deck…", onSelect: () => setCopyingTo(cards) },
          ...(deck.format === PACKAGE ? [] : [{ label: "Add to package…", onSelect: () => setPackaging(cards) }]),
          { label: "Copy as a list", keys: ["Ctrl", "C"], onSelect: () => copyList(cards) },
        ],
      },
      {
        second: true,
        items: [
          { label: "Select all", keys: ["Ctrl", "A"], onSelect: () => setSelected(new Set(deck.cards.map(selId))) },
          { label: "Clear selection", keys: ["Esc"], onSelect: () => setSelected(new Set()) },
        ],
      },
    ];
  };

  const cardMenu = (c: DeckCard, s: scry.ScryCard | undefined, className?: string) => (
    <CardMenu label={`Options for ${c.name}`} className={className} sections={menuSections(c, s)} />
  );

  /** Right-clicking a card opens the same menu at the pointer. */
  const onContextMenu = (c: DeckCard) => (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("input")) return; // the quantity box keeps the browser's menu (paste)
    e.preventDefault();
    preview.hide();
    // On one of several selected cards: the selection's menu.
    setMenu({ x: e.clientX, y: e.clientY, key: key(c, deck.cards.indexOf(c)), multi: selected.size > 1 && selected.has(selId(c)) });
  };

  const key = (c: DeckCard, i: number) => `${c.board}|${c.name}|${c.scryfallId ?? i}`;
  /**
   * Drag a card to another deck (open in another tab) to copy it there, same printing and copies.
   * Dragging one of several selected cards takes them all, under a pile with their number on it.
   */
  const dragOut = (c: DeckCard) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      // Dragging in the quantity box selects its text instead.
      if (e.target instanceof HTMLInputElement) return e.preventDefault();
      const many = selected.size > 1 && selected.has(selId(c)) ? selectedCards : null;
      e.dataTransfer.setData(CARD_TYPE, cardDragData(many ?? c));
      e.dataTransfer.setData("text/plain", many ? cardLines(many) : c.name);
      e.dataTransfer.effectAllowed = "copy";
      if (many) dragPile(e.dataTransfer, [c, ...many.filter((x) => x !== c)]);
    },
  });
  const menuCard = menu && deck.cards.find((c, i) => key(c, i) === menu.key);
  const contextMenu: ContextMenuState | null = !menuCard
    ? null
    : menu.multi && selectedCards.length > 1
      ? {
          x: menu.x,
          y: menu.y,
          title: `${selectedCards.length} cards selected`,
          subtitle: selectionSummary(selectedCards, deck.format),
          columns: true,
          sections: selectionSections(selectedCards),
        }
      : { x: menu.x, y: menu.y, sections: menuSections(menuCard, scry.cached(menuCard)) };

  /** Selection on each card: its id for the box, a ring when selected, Ctrl/⌘-click, and the card under the pointer. */
  const selProps = (c: DeckCard) => ({
    "data-sel": selId(c),
    onClickCapture: toggleOnClick(c),
    onPointerEnter: () => (hovered.current = selId(c)),
    onPointerLeave: () => hovered.current === selId(c) && (hovered.current = null),
  });
  const selClass = (c: DeckCard) => (selected.has(selId(c)) ? " selected" : "");

  const row = (c: DeckCard, i: number) => {
    const s = scry.cached(c);
    return (
      <li key={key(c, i)} className={`${s ? "card-row" : "card-row unresolved"}${selClass(c)}`} {...preview.handlers(s)} onContextMenu={onContextMenu(c)} {...dragOut(c)} {...selProps(c)}>
        {qty(c)}
        {s ? <button className="cname" title="Card details" onClick={() => openDetails(c, s)}>{c.name}</button> : <span className="cname">{c.name}</span>}
        {notWorking(c, s, "nw-badge")}
        {gameChanger(s, "gc-badge")}
        {c.tags?.length ? <span className="row-tags" title={`Tags: ${c.tags.join(", ")}`}>{c.tags.join(" · ")}</span> : null}
        {s ? <ManaCost cost={s.mana_cost ?? s.card_faces?.map((f) => f.mana_cost).filter(Boolean).join(" // ")} /> : <span className="muted small">{missing.includes(c.name) ? "not found" : lookupFailed ? "" : <span title="Looking it up"><Spinner /></span>}</span>}
        {cardMenu(c, s)}
      </li>
    );
  };

  /**
   * A card image. In the grid nothing ever covers the bottom of the card, where the artist and
   * copyright line is (Scryfall's image rules); in the overlapping views only the top of each card
   * shows (the last one shows whole). Hovering any card previews it whole. The options button
   * appears over the top-right corner on hover, the quantity over the top when there's more than one.
   */
  const tile = (c: DeckCard, i: number) => tileOf(c, i);
  /** Hovering any card previews it whole, covered or not. */
  const tileOf = (c: DeckCard, i: number) => {
    const s = scry.cached(c);
    const face = flips.face(s);
    const img = s && scry.imageUrl(s, "normal", face);
    return (
      <div key={key(c, i)} className={`card-tile${s ? "" : " unresolved"}${brokenClass(c, s)}${selClass(c)}`} {...preview.handlers(s, face)} onContextMenu={onContextMenu(c)} {...dragOut(c)} {...selProps(c)}>
        <button className="tile-img" title={s ? undefined : c.name} aria-label={`${c.quantity} × ${c.name}: card details`} disabled={!s} onClick={() => s && openDetails(c, s)}>
          {img ? <CardImg src={img} name={c.name} alt={c.name} loading="lazy" draggable={false} /> : s || missing.includes(c.name) || lookupFailed ? <span className="noimg">{c.name}{missing.includes(c.name) ? " (not found)" : ""}</span> : <CardWait name={c.name} />}
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
  /** Cards that aren't split by type (the commanders, planeswalkers beside them): rows, a grid, or columns of up to 10. */
  /** `tiled`: never overlap, even in Stacked and Spread (the commanders, so both show whole). */
  const plain = (cards: DeckCard[], extra?: React.ReactNode, tiled = false) => {
    if (view === "list") return <ul className="flat">{cards.map(row)}{extra && <li>{extra}</li>}</ul>;
    if (view === "grid" || tiled) return <div className="card-tiles">{cards.map((c, i) => tileOf(c, i))}{extra}</div>;
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
    <section ref={root} className={`panel deck-view${dropTo ? " dropping" : ""}`}>
      {warnings.length > 0 && <ul className="warnings">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {deck.format === "conquest" && (
        <p className="format-note muted small">
          <strong>Conquest: </strong>
          {CONQUEST.startingLife} life ({CONQUEST.startingLifeTwoPlayer} in 1v1) · {CONQUEST.commanderDamage} commander damage · {CONQUEST.minDeckSize}+ cards, singleton ·
          hybrid cards count as either color · players after the first scry before the game.{" "}
          <a href={CONQUEST.rulesUrl} target="_blank" rel="noopener">Full rules ↗</a>
        </p>
      )}
      {!isPlainList(deck.format) && <DeckBracket
        cards={deck.cards}
        commander={deck.format === "commander"}
        bracket={deck.bracket}
        tags={deck.bracketTags ?? []}
        onBracket={props.onBracket}
        onTags={props.onBracketTags}
      />}
      {hasCommander(deck.format) && <DeckCombos deckId={deck.id} />}
      <div className="deck-controls">
        <CardViewToggle view={view} onChange={setView} />
        <label className="group-by">
          <span className="muted">Group by</span>
          <select value={groupBy} onChange={(e) => props.onGroupBy(e.target.value as GroupBy)}>
            {GROUPINGS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </label>
      </div>
      {(() => {
        const mainLabel = isPlainList(deck.format) ? "Cards" : "Main deck";
        const sum = (g: DeckCard[]) => g.reduce((n, c) => n + c.quantity, 0);
        const commanders = [...deck.cards.filter((c) => c.board === "commander")].sort((a, z) => a.name.localeCompare(z.name));
        const main = deck.cards.filter((c) => c.board === "main");
        // Grouped by type, a few main-deck planeswalkers sit beside the commander(s) instead of further down.
        const walkers = groupBy === "type" ? main.filter((c) => scry.primaryType(scry.cached(c)) === "Planeswalker") : [];
        const besideCommander = commanders.length > 0 && walkers.length > 0 && walkers.length <= MAX_WALKERS_BESIDE_COMMANDER;

        type Group = CardGroup & { whole?: boolean; extra?: React.ReactNode; landBacks?: DeckCard[] };
        const head = (g: Group) => (
          <h4>
            {g.label}
            <span className="muted"> {sum(g.cards)}</span>
            {g.landBacks && <LandBacks cards={g.landBacks} />}
          </h4>
        );
        /** The board's groups; a lands group also counts the board's spells with a land on the back ("+ 2"). */
        const groupsOf = (cards: DeckCard[]): Group[] =>
          groupCards(cards, groupBy, scry.cached, auto).map((g) => (g.key === "type:Land" || g.key === "lands" ? { ...g, landBacks: cards } : g));
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
                          <div className="card-tiles whole-col">{g.cards.map((c, j) => tileOf(c, j))}{g.extra}</div>
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
                        {tileOf(c, i)}
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
        const isDropTarget = (k: string) => (k === "deck" || k === "main" ? dropTo === "main" : dropTo === k);
        const section = (k: string, title: string, cards: DeckCard[], body: React.ReactNode) => (
          <section key={k} className={`board${isDropTarget(k) ? " drop-target" : ""}`} data-board={k}>
            <h2>{title}<span className="muted"> {sum(cards)}</span></h2>
            {body}
          </section>
        );
        const other = (b: Board) => {
          const cards = deck.cards.filter((c) => c.board === b);
          const label = BOARDS.find((x) => x.id === b)!.label;
          if (!cards.length) {
            // While a card is dragged over the deck, an empty Considering shows where to drop it.
            return b === "maybe" && dropTo ? section(b, label, cards, <p className="drop-hint muted">Drop here to add to {label.toLowerCase()}</p>) : null;
          }
          return section(b, label, cards, laid(groupsOf(cards)));
        };

        // Stacked and Spread: the commander is the first group of the deck, beside the others.
        if (stacked) {
          const groups = walkersFirst(groupsOf(main));
          return (
            <>
              {(commanders.length > 0 || main.length > 0) &&
                section("deck", commanders.length ? "Deck" : mainLabel, [...commanders, ...main], laid(commanders.length || partnerSlot ? [commanderGroup, ...groups] : groups))}
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
            {main.length > 0 && section("main", mainLabel, main, laid(mainGroups))}
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
      {deck.format !== PACKAGE && <DeckTokens deckId={deck.id} cards={deck.cards} />}
      {deck.format !== PACKAGE && <DeckAbilities deckId={deck.id} />}
      {selectedCards.length > 0 && (
        <div className="sel-bar" role="toolbar" aria-label="Selected cards">
          <span className="sel-count">{selectedCards.length} selected</span>
          <button onClick={() => addEach(selectedCards, 1)}>+1 each <Keys keys={DECK_SHORTCUTS.addOne} /></button>
          <button onClick={() => removeEach(selectedCards)}>−1 each <Keys keys={DECK_SHORTCUTS.removeOne} /></button>
          {(["side", "maybe", "main"] as const).filter((b) => canMoveTo(b) && boardsFor(deck.format).length > 1 && selectedCards.some((c) => c.board !== b)).map((b) => (
            <button key={b} onClick={() => moveAll(selectedCards, b)}>To {boardLabel(b, deck.format).toLowerCase()} <Keys keys={moveKeys(b)!} /></button>
          ))}
          <button onClick={() => setTagging(selectedCards.map(selId))}>Tags… <Keys keys={DECK_SHORTCUTS.tags} /></button>
          <button onClick={() => setCopyingTo(selectedCards)}>Add to another deck…</button>
          <button className="sel-clear" title="Clear the selection (Esc)" aria-label="Clear the selection" onClick={() => setSelected(new Set())}>✕</button>
        </div>
      )}
      {band && <div className="marquee" style={{ left: band.left, top: band.top, width: band.right - band.left, height: band.bottom - band.top }} />}
      {preview.element}
      {contextMenu && <ContextMenu menu={contextMenu} onClose={closeMenu} />}
      {tagging && (() => {
        const cards = deck.cards.filter((x) => tagging.includes(selId(x)));
        return cards.length ? <TagEditor cards={cards} suggestions={deckTags(deck.cards)} onChange={(c, t) => props.onTags(c, t)} onClose={() => setTagging(null)} /> : null;
      })()}
      {categorizing && (() => {
        const cards = deck.cards.filter((x) => categorizing.includes(selId(x)));
        if (!cards.length) return null;
        const any = auto ?? (() => []);
        const one = cards.length === 1 ? cards[0] : undefined;
        const s = one && scry.cached(one);
        // Several cards: the categories that fit all of them, and the one they share, if they do.
        const fitsAll = cards.map((c) => fittingCategories(scry.cached(c), any)).reduce((a, b) => a.filter((k) => b.some((x) => x.toLowerCase() === k.toLowerCase())));
        const nows = [...new Set(cards.map((c) => (categoryOf(c, scry.cached(c), any) ?? scry.primaryType(scry.cached(c))).toLowerCase()))];
        return (
          <CategoryPicker
            name={one ? one.name : `${cards.length} cards`}
            now={one ? categoryOf(one, s, any) ?? scry.primaryType(s) : nows.length === 1 ? nows[0] : ""}
            automatic={one ? fittingCategories(s, any)[0] ?? scry.primaryType(s) : undefined}
            custom={cards.some((c) => c.category)}
            fits={fitsAll}
            all={categories?.names ?? []}
            used={deckCategories(deck.cards)}
            onPick={(k) => cards.forEach((c) => props.onCategory(c, k))}
            onClose={() => setCategorizing(null)}
          />
        );
      })()}
      {packaging && <AddToPackage cards={packaging} onClose={() => setPackaging(null)} />}
      {copyingTo && <AddToDeck cards={copyingTo} from={deck.id} onClose={() => setCopyingTo(null)} />}
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
            <LandBacks cards={deck.cards.filter((c) => c.board === "main")} />
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
        {/* Up here, so the window doesn't get smaller when the list arrives. */}
        {!prints && !error && <span className="small"><ScryfallWaiting text="Finding its printings…" still="Still finding its printings." /></span>}
      </div>
      {error ? <p className="form-error">{error}</p> : !prints ? (
        <div className="results"><KnownPrintings cards={[scry.cachedExact(card) ?? scry.cached(card)]} selected={card.scryfallId} /></div>
      ) : (
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
                <CardImg src={scry.imageUrl(p, "normal", flips.face(p)) ?? ""} name={p.set_name} alt={p.set_name} loading="lazy" />
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
const DRAWER_BAR = 52;
const DRAWER_KEY = "cq.deckDrawerHeight";
/** Dragged lower than this above the bar, the drawer closes. */
const DRAWER_MIN_OPEN = 140;
const drawerMax = () => window.innerHeight - 80;

function savedDrawerHeight(): number | null {
  try {
    const n = Number(localStorage.getItem(DRAWER_KEY));
    return n >= DRAWER_MIN_OPEN ? n : null;
  } catch {
    return null;
  }
}

/**
 * The deck in a drawer along the bottom of the search page. Click the bar to open or close it, or
 * drag the bar to make it as tall or short as you like (dragging nearly all the way down closes
 * it). The height you leave it at is remembered in this browser.
 */
/** `side`: shown over the right end of the bar (the deck's type counts). */
function DeckDrawer({ open, onToggle, name, badge, badgeOk, side, children }: { open: boolean; onToggle: () => void; name: string; badge: string; badgeOk: boolean; side?: React.ReactNode; children: React.ReactNode }) {
  const [height, setHeight] = useState<number | null>(savedDrawerHeight);
  /** While dragging: the live height. */
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{ y: number; from: number; moved: boolean } | null>(null);
  /** A drag ends with a click on the bar; that click mustn't toggle the drawer. */
  const swallowClick = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open], .card-menu")) onToggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onToggle]);

  const keep = (h: number) => {
    setHeight(h);
    try {
      localStorage.setItem(DRAWER_KEY, String(Math.round(h)));
    } catch {
      // Storage blocked: lasts until the page reloads.
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    drag.current = { y: e.clientY, from: open ? (ref.current?.getBoundingClientRect().height ?? DRAWER_BAR) : DRAWER_BAR, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientY - d.y) < 5) return;
    d.moved = true;
    setDragHeight(Math.min(drawerMax(), Math.max(DRAWER_BAR, d.from + d.y - e.clientY)));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved || dragHeight === null) return;
    swallowClick.current = true;
    setDragHeight(null);
    if (dragHeight < DRAWER_MIN_OPEN) {
      if (open) onToggle();
    } else {
      keep(dragHeight);
      if (!open) onToggle();
    }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const now = ref.current?.getBoundingClientRect().height ?? DRAWER_MIN_OPEN;
    keep(Math.min(drawerMax(), Math.max(DRAWER_MIN_OPEN, now + (e.key === "ArrowUp" ? 60 : -60))));
  };

  const shown = dragHeight ?? (open ? height : null);
  const style = shown !== null ? { height: `min(${shown}px, calc(100vh - 80px))` } : undefined;
  return (
    <div ref={ref} className={`deck-drawer${open ? " open" : ""}${dragHeight !== null ? " dragging" : ""}`} style={style} role="region" aria-label="Your deck">
      <button
        className="deck-drawer-bar"
        aria-expanded={open}
        onClick={() => (swallowClick.current ? (swallowClick.current = false) : onToggle())}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => ((drag.current = null), setDragHeight(null))}
        onKeyDown={onKeyDown}
        title={open ? "Click to lower the deck, or drag to resize (arrow keys too)" : "Click to show your deck, or drag it up"}
      >
        <span className="deck-drawer-grip" aria-hidden="true" />
        <span className="deck-drawer-title">
          <strong>{name}</strong>
          <span className="count-badge" data-ok={String(badgeOk)}>{badge}</span>
        </span>
        <span className="deck-drawer-toggle">{open ? "Hide deck ▾" : "Show deck ▴"}</span>
      </button>
      {/* Beside the bar's button, not in it: the counts are hoverable and focusable themselves. */}
      {side}
      {(open || (dragHeight ?? 0) > DRAWER_BAR) && <div className="deck-drawer-body">{children}</div>}
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
      {error ? <p className="form-error">{error}</p> : !cards ? <Loading text="Finding cards that pair with it…" slow="Still finding cards. Scryfall is slow right now." /> : !cards.length ? <p className="muted">Scryfall has no cards that pair with {commander.name}.</p> : (
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
                  {scry.imageUrl(c, "normal", face) ? <CardImg src={scry.imageUrl(c, "normal", face)!} name={c.name} alt={c.name} loading="lazy" /> : <span className="noimg">{c.name}</span>}
                  <span className="small">{c.name}</span>
                  {st && !st.works && <span className="small form-error">{st.missing ? "Not playable yet" : "Known issue"}</span>}
                </button>
                <FlipButton card={c} face={face} onFlip={flips.toggle} />
              </div>
            );
          })}
          {next && (
            <button className="btn ghost wide partner-more" disabled={loadingMore} onClick={() => void more()}>
              <BusyLabel busy={loadingMore} working="Loading…">Load more</BusyLabel>
            </button>
          )}
        </div>
      )}
    </dialog>
  );
}

/** A card's tags: chips to remove, the deck's other tags to add with a click, or a new one typed in. */
/**
 * A card's tags, or the tags of several selected cards: a tag on all of them is shown set (click to
 * take it off all), one on only some shows how many (click to put it on all), and new or used tags
 * go on all of them.
 */
function TagEditor({ cards, suggestions, onChange, onClose }: { cards: DeckCard[]; suggestions: string[]; onChange: (card: DeckCard, tags: string[]) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState("");
  useEffect(() => ref.current?.showModal(), []);
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const tagsOf = (c: DeckCard) => c.tags ?? [];
  const hasTag = (c: DeckCard, t: string) => tagsOf(c).some((x) => same(x, t));
  /** Every tag on any of the cards, each once, with how many cards have it. */
  const present = [...new Map(cards.flatMap(tagsOf).map((t) => [t.toLowerCase(), t])).values()].map((t) => ({ t, n: cards.filter((c) => hasTag(c, t)).length }));
  const full = cards.every((c) => tagsOf(c).length >= MAX_CARD_TAGS);
  const others = suggestions.filter((t) => !present.some((p) => same(p.t, t)));
  const addAll = (t: string) => {
    for (const c of cards) if (!hasTag(c, t) && tagsOf(c).length < MAX_CARD_TAGS) onChange(c, [...tagsOf(c), t]);
  };
  const removeAll = (t: string) => {
    for (const c of cards) if (hasTag(c, t)) onChange(c, tagsOf(c).filter((x) => !same(x, t)));
  };
  function add(e: React.FormEvent) {
    e.preventDefault();
    const t = draft.trim().replace(/\s+/g, " ");
    if (t && !full) addAll(t);
    setDraft("");
  }
  const many = cards.length > 1;
  return (
    <dialog ref={ref} className="new-deck tag-editor" onClose={onClose} onClick={(e) => closeOnBackdrop(e.nativeEvent, ref.current)}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <form onSubmit={add}>
        <h3>Tags for {many ? `${cards.length} cards` : cards[0].name}</h3>
        <p className="muted small">
          {many ? "Tags you add go on every selected card. " : ""}Group the deck by your tags with Group by → Tag, or Type &amp; tag. A card can have several.
        </p>
        <div className="reason-tags">
          {present.length ? (
            present.map(({ t, n }) =>
              n === cards.length ? (
                <button type="button" key={t} className="reason-tag on" title={many ? "Take this tag off all of them" : "Remove this tag"} onClick={() => removeAll(t)}>
                  {t} <span aria-hidden="true">×</span>
                </button>
              ) : (
                <button type="button" key={t} className="reason-tag" title={`On ${n} of ${cards.length}: put it on all of them`} onClick={() => addAll(t)}>
                  + {t} <span className="muted">{n}/{cards.length}</span>
                </button>
              ),
            )
          ) : (
            <span className="muted small">No tags yet.</span>
          )}
        </div>
        {others.length > 0 && (
          <div>
            <p className="muted small tag-editor-sub">Used in this deck</p>
            <div className="reason-tags">
              {others.map((t) => (
                <button type="button" key={t} className="reason-tag" disabled={full} onClick={() => addAll(t)}>+ {t}</button>
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

/** Choose the one category a card shows under: one it fits, any other, or a new one typed in. */
function CategoryPicker(props: {
  /** The card's name, or "3 cards". */
  name: string;
  /** The category now ("" when several cards differ). */
  now: string;
  /** The automatic category, for one card. */
  automatic?: string;
  /** Some of the cards have a category of the player's own. */
  custom: boolean;
  fits: string[];
  all: string[];
  used: string[];
  onPick: (category: string | undefined) => void;
  onClose: () => void;
}) {
  const { now, fits } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState("");
  useEffect(() => ref.current?.showModal(), []);
  const pick = (category: string | undefined) => {
    props.onPick(category);
    ref.current?.close();
  };
  const isNow = (k: string) => !!now && k.toLowerCase() === now.toLowerCase();
  // Each name once, however it's spelled: the player's own spelling first.
  const others = [...new Map([...props.all, ...props.used].map((k) => [k.toLowerCase(), k])).values()]
    .filter((k) => !fits.some((f) => f.toLowerCase() === k.toLowerCase()))
    .sort((a, z) => a.localeCompare(z));
  const chips = (names: string[]) => (
    <div className="reason-tags">
      {names.map((k) => (
        <button type="button" key={k} className={`reason-tag${isNow(k) ? " on" : ""}`} aria-pressed={isNow(k)} onClick={() => pick(k)}>{k}</button>
      ))}
    </div>
  );
  return (
    <dialog ref={ref} className="new-deck tag-editor" onClose={props.onClose} onClick={(e) => closeOnBackdrop(e.nativeEvent, ref.current)}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) pick(draft);
        }}
      >
        <h3>Category for {props.name}</h3>
        <p className="muted small">
          A card shows under one category. Automatic ones come from <a href="https://tagger.scryfall.com/" target="_blank" rel="noopener">Scryfall Tagger</a>, where players tag what cards do.
        </p>
        {fits.length > 0 && (
          <div>
            <p className="muted small tag-editor-sub">{props.automatic ? "Fits this card" : "Fits all of them"}</p>
            {chips(fits)}
          </div>
        )}
        <div>
          <p className="muted small tag-editor-sub">{fits.length ? "Others" : "Categories"}</p>
          {chips(others)}
        </div>
        <div className="tag-editor-add">
          <input value={draft} maxLength={MAX_CARD_TAG_LENGTH} placeholder="New category, e.g. Win condition" aria-label="New category" onChange={(e) => setDraft(e.target.value)} />
          <button className="btn" disabled={!draft.trim()}>Use</button>
        </div>
        <div className="actions new-deck-actions">
          {props.custom && <button type="button" className="btn ghost" onClick={() => pick(undefined)}>{props.automatic ? `Automatic (${props.automatic})` : "Automatic"}</button>}
          <button type="button" className="btn ghost" onClick={() => ref.current?.close()}>Done</button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * "+ 2" after a land count: the modal double-faced cards among `cards` that can be played as a
 * land from their back. Hovering (or focusing) it lists them. The list is placed on screen with
 * fixed coordinates, so a group heading that clips its overflow doesn't cut it off.
 */
function LandBacks({ cards }: { cards: DeckCard[] }) {
  const [at, setAt] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const backs = cards.flatMap((c) => {
    const s = scry.cached(c);
    return s && playableLandBack(s) ? [c] : [];
  });
  const n = backs.reduce((t, c) => t + c.quantity, 0);
  if (!n) return null;
  const show = (e: React.SyntheticEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const width = 300;
    setAt({ x: Math.max(8, Math.min(r.left, innerWidth - width - 8)), y: r.top > 220 ? innerHeight - r.top + 8 : r.bottom + 8, below: r.top <= 220 });
  };
  return (
    <span
      className="land-backs"
      tabIndex={0}
      aria-label={`plus ${n} modal double-faced ${n === 1 ? "card" : "cards"} that can be played as a land`}
      onMouseEnter={show}
      onFocus={show}
      onMouseLeave={() => setAt(null)}
      onBlur={() => setAt(null)}
    >
      {" "}+ {n}
      {at && (
        <span className="curve-tip land-backs-tip" role="tooltip" style={at.below ? { left: at.x, top: at.y, bottom: "auto" } : { left: at.x, bottom: at.y, top: "auto" }}>
          <strong>Can be played as a land</strong>
          <ul>
            {[...backs].sort((a, z) => a.name.localeCompare(z.name)).map((c) => (
              <li key={`${c.board}|${c.name}`}>
                {c.quantity > 1 && <span className="muted">{c.quantity} × </span>}
                {c.name}
              </li>
            ))}
          </ul>
        </span>
      )}
    </span>
  );
}
