import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Board, DeckCard } from "../../convex/model/deckRules";
import { errorMessage } from "../app/errors";
import { navigate, replaceQuietly, useLeaveGuard, useRoute } from "../app/router";
import { closeOnBackdrop, showCardDetails } from "../carddetails";
import { mergeDuplicates, parseDecklist, writeDecklist, type ParsedToken } from "../decklist";
import { toast } from "../dom";
import { CardMenu } from "../components/CardMenu";
import { DeckTokens } from "../components/DeckTokens";
import { ManaCost } from "../components/ManaCost";
import { Loading } from "../components/Spinner";
import { CONQUEST, validateConquest } from "../formats/conquest";
import * as scry from "../scryfall";
import { tokenPicks } from "../tokens";
import { BOARDS } from "./boards";
import { SearchBox, SearchResults } from "./EditorSearch";
import { capitalize } from "./DeckList";

const FORMATS = ["commander", "conquest", "standard", "pioneer", "modern", "legacy", "vintage", "pauper", "other"];
/** Up to this many main-deck planeswalkers are shown beside the commander(s). */
const MAX_WALKERS_BESIDE_COMMANDER = 3;
const TYPE_ORDER = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land", "Other"];
const COLORS: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const UNTITLED = "Untitled deck";

type TokenPick = { identity: string; scryfallId: string };

interface Draft {
  id?: Id<"decks">;
  name: string;
  format: string;
  cards: DeckCard[];
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
  const initial: Draft = saved ? { id: saved._id, name: saved.name, format: saved.format, cards: saved.cards } : { name: UNTITLED, format: "commander", cards: [] };
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
  const [, setCardData] = useState(0); // bumped when Scryfall data arrives, to re-render
  const [tab, setTab] = useState<"search" | "import">(query.has("import") ? "import" : "search");
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [addTo, setAddTo] = useState<Board>("main");

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
    // and fill in printings for cards that don't have one.
    setDeck((d) => {
      let changed = false;
      const next = d.cards.map((c) => {
        const s = scry.cachedExact(c) ?? scry.cached(c);
        if (!s) return c;
        const out = { ...c };
        if (out.name !== scry.deckName(s)) (out.name = scry.deckName(s)), (changed = true);
        if (!out.scryfallId) {
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
    void resolveCards(initial.cards);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Deck changes ----
  function addCard(c: scry.ScryCard, board: Board) {
    const name = scry.deckName(c);
    change((d) => {
      const existing = d.cards.find((x) => x.board === board && x.name.toLowerCase() === name.toLowerCase());
      if (existing) existing.quantity++;
      else d.cards.push({ name, quantity: 1, board, scryfallId: c.id, set: c.set, collectorNumber: c.collector_number });
      return d;
    });
    toast(`Added ${name}${board === "main" ? "" : " to " + BOARDS.find((b) => b.id === board)!.label.toLowerCase()}`);
  }

  async function addByName(name: string) {
    try {
      addCard(await scry.named(name), addTo);
    } catch (e) {
      toast(`Couldn't find ${name}: ${errorMessage(e)}`, "error");
    }
  }

  function setQty(target: DeckCard, q: number) {
    const i = deck.cards.indexOf(target);
    change((d) => {
      if (q <= 0) d.cards.splice(i, 1);
      else d.cards[i].quantity = Math.min(q, 250);
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
    const body = { name: d.name, format: d.format, cards: d.cards };
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
        replaceQuietly(`/decks/${id}`);
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
  const badge = deck.format === "commander" ? `${total}/100` : deck.format === "conquest" ? `${total}/${CONQUEST.minDeckSize}+` : `${total} cards`;
  const badgeOk = deck.format === "commander" ? total === 100 : deck.format === "conquest" ? total >= CONQUEST.minDeckSize : true;
  const saveState = saving
    ? "Saving…"
    : saveError
      ? `Not saved: ${saveError}`
      : dirty
        ? "Saving soon…"
        : savedOnce
          ? "All changes saved"
          : "Saves automatically";

  return (
    <div className="editor">
      <div className="editor-head">
        <a href="#/decks" className="back" title="Back to decks">←</a>
        <input className="deck-name" value={deck.name} maxLength={100} aria-label="Deck name" onChange={(e) => change((d) => ({ ...d, name: e.target.value }))} />
        <select aria-label="Format" value={deck.format} onChange={(e) => change((d) => ({ ...d, format: e.target.value }))}>
          {FORMATS.map((f) => <option key={f} value={f}>{capitalize(f)}</option>)}
        </select>
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
        <button className="btn ghost danger" onClick={() => void remove()} title="Delete deck">Delete</button>
      </div>
      {searchQuery !== null ? (
        <SearchResults
          query={searchQuery}
          format={deck.format}
          deck={deck.cards}
          defaultBoard={addTo}
          onDefaultBoard={setAddTo}
          onAdd={addCard}
          onQty={setQty}
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
            <SearchPane hidden={tab !== "search"} addTo={addTo} onAddTo={setAddTo} onPick={(n) => void addByName(n)} onSubmit={setSearchQuery} autoFocus={!deck.cards.length && tab === "search"} />
            <ImportPane hidden={tab !== "import"} startReplacing={deck.cards.length === 0} onImport={applyImport} importFromUrl={(url) => importFromUrl({ url })} autoFocus={tab === "import"} />
          </aside>
          <DeckView deck={deck} missing={missing} count={count} onQty={setQty} onMove={moveCard} onPrinting={setPrinting} />
        </div>
      )}
    </div>
  );
}

// ---- Hover preview (beside the cursor) ----------------------------------------------

function usePreview() {
  const [preview, setPreview] = useState<{ url: string; x: number; y: number } | null>(null);
  const position = (e: React.MouseEvent) => {
    const w = 250, h = 349, pad = 18;
    let x = e.clientX + pad;
    if (x + w > innerWidth) x = e.clientX - w - pad;
    const y = Math.min(Math.max(8, e.clientY - h / 2), innerHeight - h - 8);
    return { x, y };
  };
  const handlers = (c: scry.ScryCard | undefined) => ({
    onMouseEnter: (e: React.MouseEvent) => {
      if (!c || matchMedia("(hover: none)").matches) return;
      const url = scry.imageUrl(c, "normal");
      if (url) setPreview({ url, ...position(e) });
    },
    onMouseMove: (e: React.MouseEvent) => setPreview((p) => (p ? { ...p, ...position(e) } : p)),
    onMouseLeave: () => setPreview(null),
  });
  const element = preview && (
    <div className="preview" style={{ transform: `translate(${preview.x}px, ${preview.y}px)` }}>
      <img src={preview.url} alt="" />
    </div>
  );
  return { handlers, element, hide: () => setPreview(null) };
}

// ---- Search ---------------------------------------------------------------------------

function SearchPane(props: { hidden: boolean; addTo: Board; onAddTo: (b: Board) => void; onPick: (name: string) => void; onSubmit: (q: string) => void; autoFocus: boolean }) {
  return (
    <div className="pane" hidden={props.hidden}>
      <SearchBox onPick={props.onPick} onSubmit={props.onSubmit} autoFocus={props.autoFocus} />
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
  onPrinting: (c: DeckCard, p: scry.ScryCard) => void;
}) {
  const { deck, missing, count } = props;
  const preview = usePreview();
  const [printingsFor, setPrintingsFor] = useState<DeckCard | null>(null);
  const [view, setView] = useDeckViewMode();
  const warnings = useMemo(() => deckWarnings(deck, missing, count), [deck, missing, count]);

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
      <span>{c.quantity}</span>
      <button className="qbtn" aria-label="One more" onClick={() => props.onQty(c, c.quantity + 1)}>+</button>
    </span>
  );

  /** Every action for one deck entry, in a dark popup menu (no native <select>). */
  const cardMenu = (c: DeckCard, s: scry.ScryCard | undefined, className?: string) => {
    const boardLabel = BOARDS.find((b) => b.id === c.board)!.label;
    return (
      <CardMenu
        label={`Options for ${c.name}`}
        className={className}
        sections={[
          {
            title: `${c.quantity} × ${c.name} · ${boardLabel}`,
            items: [
              { label: "+ Add one", keepOpen: true, onSelect: () => props.onQty(c, c.quantity + 1) },
              { label: "− Remove one", keepOpen: c.quantity > 1, onSelect: () => props.onQty(c, c.quantity - 1) },
            ],
          },
          {
            items: [
              { label: "Card details", disabled: !s, onSelect: () => s && openDetails(c, s) },
              { label: "Choose printing…", onSelect: () => setPrintingsFor(c) },
            ],
          },
          {
            title: "Move to",
            items: BOARDS.filter((b) => b.id !== c.board).map((b) => ({ label: b.label, onSelect: () => props.onMove(c, b.id) })),
          },
          { items: [{ label: c.quantity > 1 ? `Remove all ${c.quantity}` : "Remove from deck", danger: true, onSelect: () => props.onQty(c, 0) }] },
        ]}
      />
    );
  };

  const key = (c: DeckCard, i: number) => `${c.board}|${c.name}|${c.scryfallId ?? i}`;

  const row = (c: DeckCard, i: number) => {
    const s = scry.cached(c);
    return (
      <li key={key(c, i)} className={s ? "card-row" : "card-row unresolved"} {...preview.handlers(s)}>
        {qty(c)}
        {s ? <button className="cname" title="Card details" onClick={() => openDetails(c, s)}>{c.name}</button> : <span className="cname">{c.name}</span>}
        {s ? <ManaCost cost={s.mana_cost ?? s.card_faces?.map((f) => f.mana_cost).filter(Boolean).join(" // ")} /> : <span className="muted small">{missing.includes(c.name) ? "not found" : ""}</span>}
        {cardMenu(c, s)}
      </li>
    );
  };

  /**
   * A whole card image. Nothing ever covers the bottom of the card, where the artist and
   * copyright line is (Scryfall's image rules). The options button appears over the top-right
   * corner on hover, and the quantity sits over the top-left when there's more than one.
   */
  const tile = (c: DeckCard, i: number) => {
    const s = scry.cached(c);
    const img = s && scry.imageUrl(s, "normal");
    return (
      <div key={key(c, i)} className={s ? "card-tile" : "card-tile unresolved"}>
        <button className="tile-img" title={s ? `${c.name}: card details` : c.name} disabled={!s} onClick={() => s && openDetails(c, s)}>
          {img ? <img src={img} alt={c.name} loading="lazy" /> : <span className="noimg">{c.name}{missing.includes(c.name) ? " (not found)" : ""}</span>}
        </button>
        {/* The name as invisible text over the printed one, so the browser's find (Ctrl+F) finds and highlights cards. */}
        {img && <span className="tile-name" aria-hidden="true">{c.name}</span>}
        {c.quantity > 1 && <span className="tile-qty" aria-label={`${c.quantity} copies`}>×{c.quantity}</span>}
        {cardMenu(c, s, "tile-menu")}
      </div>
    );
  };

  const asImages = view === "images";
  const items = (cards: DeckCard[]) => (asImages ? <div className="card-tiles">{cards.map(tile)}</div> : <ul>{cards.map(row)}</ul>);

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
      <div className="view-toggle" role="group" aria-label="Show the deck as">
        <button aria-pressed={view === "list"} onClick={() => setView("list")}>☰ List</button>
        <button aria-pressed={view === "images"} onClick={() => setView("images")}>▦ Cards</button>
      </div>
      <Stats deck={deck} count={count} />
      {(() => {
        // A few main-deck planeswalkers sit beside the commander(s) instead of further down.
        const commanders = deck.cards.filter((c) => c.board === "commander");
        const walkers = deck.cards.filter((c) => c.board === "main" && scry.primaryType(scry.cached(c)) === "Planeswalker");
        const besideCommander = commanders.length > 0 && walkers.length > 0 && walkers.length <= MAX_WALKERS_BESIDE_COMMANDER;

        const sortByCmc = (g: DeckCard[]) => g.sort((a, z) => (scry.cached(a)?.cmc ?? 0) - (scry.cached(z)?.cmc ?? 0) || a.name.localeCompare(z.name));
        const sum = (g: DeckCard[]) => g.reduce((n, c) => n + c.quantity, 0);

        const board = (b: (typeof BOARDS)[number]) => {
          const cards = deck.cards.filter((c) => c.board === b.id);
          if (!cards.length) return null;
          let body: React.ReactNode;
          if (b.id === "main" || b.id === "side") {
            const groups = new Map<string, DeckCard[]>();
            for (const c of cards) {
              const t = scry.primaryType(scry.cached(c));
              if (b.id === "main" && t === "Planeswalker" && besideCommander) continue;
              groups.set(t, [...(groups.get(t) ?? []), c]);
            }
            body = (
              <div className={asImages ? "image-groups" : "type-groups"}>
                {TYPE_ORDER.filter((t) => groups.has(t)).map((t) => {
                  const g = sortByCmc(groups.get(t)!);
                  return (
                    <div key={t} className="type-group">
                      <h4>
                        {t === "Other" && !g.some((c) => scry.cached(c)) ? "Loading…" : t}
                        <span className="muted"> {sum(g)}</span>
                      </h4>
                      {items(g)}
                    </div>
                  );
                })}
              </div>
            );
          } else {
            const sorted = [...cards].sort((a, z) => a.name.localeCompare(z.name));
            body = asImages ? <div className="card-tiles">{sorted.map(tile)}</div> : <ul className="flat">{sorted.map(row)}</ul>;
          }
          return (
            <section key={b.id} className="board">
              <h2>{b.label}<span className="muted"> {sum(cards)}</span></h2>
              {body}
            </section>
          );
        };

        return BOARDS.map((b) => {
          if (b.id !== "commander" || !besideCommander) return board(b);
          return (
            <div key="top" className="top-row">
              {board(b)}
              <section className="board walkers">
                <h2>Planeswalkers<span className="muted"> {sum(walkers)} · main deck</span></h2>
                {asImages ? <div className="card-tiles">{sortByCmc(walkers).map(tile)}</div> : <ul className="flat">{sortByCmc(walkers).map(row)}</ul>}
              </section>
            </div>
          );
        });
      })()}
      <DeckTokens deckId={deck.id} cards={deck.cards} />
      {preview.element}
      {printingsFor && <Printings card={printingsFor} onPick={(p) => props.onPrinting(printingsFor, p)} onClose={() => setPrintingsFor(null)} />}
    </section>
  );
}

const VIEW_KEY = "cq.deckView";

/** List or card images; remembered per browser (a viewer preference, not deck data). */
function useDeckViewMode(): ["list" | "images", (v: "list" | "images") => void] {
  const [view, setView] = useState<"list" | "images">(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "images" ? "images" : "list";
    } catch {
      return "list";
    }
  });
  const set = (v: "list" | "images") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Storage blocked: the choice lasts until the page reloads.
    }
  };
  return [view, set];
}

function deckWarnings(deck: Draft, missing: string[], count: (b?: Board) => number): string[] {
  const w: string[] = [];
  const list = (names: string[]) => names.slice(0, 6).join(", ") + (names.length > 6 ? "…" : "");
  if (missing.length) w.push(`Scryfall doesn't know: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""}. Check the spelling.`);
  const fmt = deck.format;
  if (fmt === "conquest") return [...w, ...validateConquest(deck.cards.map((c) => ({ ...c, card: scry.cached(c) })))];
  if (fmt === "commander") {
    const cmdrs = deck.cards.filter((c) => c.board === "commander");
    const total = count();
    if (!cmdrs.length) w.push("No commander yet. Use ★ on a search result or move a card to the Commander board.");
    if (cmdrs.reduce((n, c) => n + c.quantity, 0) > 2) w.push("A deck can have at most two commanders.");
    if (total !== 100) w.push(`Commander decks have exactly 100 cards (you have ${total}).`);
    const identity = new Set(cmdrs.flatMap((c) => scry.cached(c)?.color_identity ?? []));
    const offColor: string[] = [];
    const dupes: string[] = [];
    for (const c of deck.cards) {
      if (c.board !== "main") continue;
      const s = scry.cached(c);
      if (!s) continue;
      if (cmdrs.length && s.color_identity.some((x) => !identity.has(x))) offColor.push(c.name);
      const unlimited = /Basic/.test(s.type_line) || /any number of cards named/i.test(s.oracle_text ?? "");
      if (c.quantity > 1 && !unlimited) dupes.push(c.name);
    }
    if (offColor.length) w.push(`Outside your commander's colors: ${list(offColor)}.`);
    if (dupes.length) w.push(`Commander is singleton, but you have multiples of: ${list(dupes)}.`);
  }
  if (fmt !== "other") {
    const illegal = deck.cards
      .filter((c) => c.board !== "maybe")
      .filter((c) => {
        const l = scry.cached(c)?.legalities?.[fmt];
        return l === "banned" || l === "not_legal";
      })
      .map((c) => c.name);
    if (illegal.length) w.push(`Not legal in ${capitalize(fmt)}: ${list(illegal)}.`);
  }
  return w;
}

function Stats({ deck, count }: { deck: Draft; count: (b?: Board) => number }) {
  const curve = new Array(8).fill(0);
  let lands = 0;
  for (const c of deck.cards) {
    if (c.board !== "main") continue;
    const s = scry.cached(c);
    if (!s) continue;
    if (scry.primaryType(s) === "Land") lands += c.quantity;
    else curve[Math.min(7, Math.floor(s.cmc))] += c.quantity;
  }
  const max = Math.max(1, ...curve);
  const identity = [...new Set(deck.cards.filter((c) => c.board === "commander").flatMap((c) => scry.cached(c)?.color_identity ?? []))];
  return (
    <div className="stats">
      <div className="curve" title="Mana curve (main deck, nonland)">
        {curve.map((n, i) => (
          <div key={i} className="bar-col">
            <span className="bar-n">{n || ""}</span>
            <div className="bar" style={{ height: `${(n / max) * 100}%` }} />
            <span className="bar-label">{i === 7 ? "7+" : i}</span>
          </div>
        ))}
      </div>
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
        <p><span className="muted">Lands </span>{lands}</p>
        <p><span className="muted">Sideboard / maybe </span>{count("side")} / {count("maybe")}</p>
      </div>
    </div>
  );
}

function Printings({ card, onPick, onClose }: { card: DeckCard; onPick: (p: scry.ScryCard) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [prints, setPrints] = useState<scry.ScryCard[] | null>(null);
  const [error, setError] = useState("");
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
            <button
              key={p.id}
              className={p.id === card.scryfallId ? "result-img selected" : "result-img"}
              title={`${p.set_name} #${p.collector_number}`}
              onClick={() => {
                onPick(p);
                ref.current?.close();
              }}
            >
              <img src={scry.imageUrl(p, "normal") ?? ""} alt={p.set_name} loading="lazy" />
              <span className="small muted">{p.set.toUpperCase()} #{p.collector_number}</span>
              {scry.artistOf(p) && <span className="small muted">{scry.artistOf(p)}</span>}
            </button>
          ))}
        </div>
      )}
    </dialog>
  );
}
