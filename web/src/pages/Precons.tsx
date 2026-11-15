import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { DeckCard } from "../../convex/model/deckRules";
import { errorMessage } from "../app/errors";
import { closeOnBackdrop, showCardDetails } from "../carddetails";
import { mergeDuplicates } from "../decklist";
import { toast } from "../dom";
import { ManaCost } from "../components/ManaCost";
import { Loading } from "../components/Spinner";
import { cardCount, deckCards, formatOf, loadPrecons, matches, releaseLabel, type Precon } from "../precons";
import * as scry from "../scryfall";
import { useCardPreview } from "../useCardPreview";
import { TYPE_ORDER } from "./boards";

type Kind = Precon["kind"];

/** Picks Scryfall printings (the precon's own set where Scryfall has it), so the deck shows art right away. */
async function withPrintings(p: Precon): Promise<DeckCard[]> {
  const cards = deckCards(p);
  try {
    await scry.resolve(cards);
  } catch {
    // Scryfall unavailable: save names and sets; the editor fills in printings when it opens.
    return cards;
  }
  return mergeDuplicates(
    cards.map((c) => {
      const s = scry.cachedExact(c) ?? scry.cached(c);
      return s ? { ...c, name: scry.deckName(s), scryfallId: s.id, set: s.set, collectorNumber: s.collector_number } : c;
    }),
  );
}

export function Precons() {
  const [precons, setPrecons] = useState<Precon[] | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<Kind>("commander");
  const [query, setQuery] = useState("");
  const [viewing, setViewing] = useState<Precon | null>(null);
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [, setArtLoaded] = useState(0);
  const myDecks = useQuery(api.decks.list);
  const createDeck = useMutation(api.decks.create);

  useEffect(() => {
    loadPrecons().then(setPrecons).catch((e) => setError(errorMessage(e)));
  }, []);

  const shown = useMemo(() => (precons ?? []).filter((p) => p.kind === kind && matches(p, query)), [precons, kind, query]);
  const counts = useMemo(() => ({
    commander: (precons ?? []).filter((p) => p.kind === "commander").length,
    constructed: (precons ?? []).filter((p) => p.kind === "constructed").length,
  }), [precons]);

  // Your deck with the same name, so a precon you already added links to your copy.
  const mine = useMemo(() => new Map((myDecks ?? []).map((d) => [d.name.toLowerCase(), d._id as string])), [myDecks]);

  // Cover art: the commander's art crop from the precon's own set.
  const coverCards = useMemo(
    () => shown.flatMap((p) => (p.commander[0] ? [{ name: p.commander[0][1], quantity: 1, board: "commander" as const, set: p.commander[0][2] || undefined }] : [])),
    [shown],
  );
  const coverKey = coverCards.map((c) => `${c.name}|${c.set}`).join(",");
  useEffect(() => {
    if (!coverCards.length) return;
    scry.resolve(coverCards).then(() => setArtLoaded((n) => n + 1)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverKey]);

  async function add(p: Precon) {
    setAdding((s) => new Set(s).add(p.id));
    try {
      const id = await createDeck({ name: p.name, format: formatOf(p), cards: await withPrintings(p) });
      toast(`Added ${p.name} to your decks`);
      return id;
    } catch (e) {
      toast(`Couldn't add ${p.name}: ${errorMessage(e)}`, "error");
    } finally {
      setAdding((s) => {
        const next = new Set(s);
        next.delete(p.id);
        return next;
      });
    }
  }

  const addButton = (p: Precon) => {
    const own = mine.get(p.name.toLowerCase());
    if (own) return <a className="btn ghost small" href={`#/decks/${own}`}>In your decks · Open</a>;
    return (
      <button className="btn small" disabled={adding.has(p.id) || myDecks === undefined} onClick={() => void add(p)}>
        {adding.has(p.id) ? "Adding…" : "Add to my decks"}
      </button>
    );
  };

  return (
    <>
      <div className="page-head row">
        <div>
          <a href="#/decks" className="link small">← Your decks</a>
          <h1>Precon decks</h1>
        </div>
        <input className="precon-search" type="search" placeholder="Search by deck, commander or set" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="tabs precon-tabs" role="tablist">
        <button role="tab" aria-selected={kind === "commander"} className={kind === "commander" ? "tab active" : "tab"} onClick={() => setKind("commander")}>
          Commander{precons ? ` (${counts.commander})` : ""}
        </button>
        <button role="tab" aria-selected={kind === "constructed"} className={kind === "constructed" ? "tab active" : "tab"} onClick={() => setKind("constructed")}>
          Other precons{precons ? ` (${counts.constructed})` : ""}
        </button>
      </div>
      <p className="muted small">Newest first. Adding a precon copies it into your decks, where you can edit it like any other deck.</p>
      {error ? (
        <p className="form-error">{error}</p>
      ) : !precons ? (
        <Loading />
      ) : !shown.length ? (
        <div className="empty card"><h3>No precons match “{query}”</h3></div>
      ) : (
        <div className="deck-grid">
          {shown.map((p) => {
            const cmdr = p.commander[0];
            const card = cmdr ? scry.cachedInSet(cmdr[1], cmdr[2]) ?? scry.cached({ name: cmdr[1], quantity: 1, board: "commander" }) : undefined;
            const art = card && (card.card_faces?.[0]?.image_uris?.art_crop ?? card.image_uris?.art_crop);
            return (
              <div key={p.id} className="deck-tile precon-tile">
                <button className="deck-cover precon-cover" style={art ? { backgroundImage: `url("${art}")` } : undefined} onClick={() => setViewing(p)} aria-label={`View the ${p.name} deck`}>
                  {art ? <span className="art-credit">Art by {scry.artistOf(card!) ?? "unknown"} · © Wizards of the Coast</span> : <span className="precon-set">{p.set.toUpperCase()}</span>}
                </button>
                <div className="deck-meta">
                  <h3>{p.name}</h3>
                  {p.commander.length > 0 && <p>{p.commander.map((c) => c[1]).join(" & ")}</p>}
                  <p className="muted small">{p.setName} · {releaseLabel(p.date) || "Undated"} · {cardCount(p)} cards</p>
                  <div className="actions precon-actions">
                    {addButton(p)}
                    <button className="btn ghost small" onClick={() => setViewing(p)}>View deck</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {viewing && <PreconList precon={viewing} addButton={addButton(viewing)} onClose={() => setViewing(null)} />}
    </>
  );
}

type View = "stacks" | "list";
const VIEW_KEY = "cq.preconView";

/** Card pictures (the default) or a text list; remembered per browser. */
function usePreconView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "stacks";
    } catch {
      return "stacks";
    }
  });
  const set = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Storage blocked: the choice lasts until the page reloads.
    }
  };
  return [view, set];
}

interface Group {
  key: string;
  label: string;
  cards: DeckCard[];
}

const lookup = (c: DeckCard) => scry.cachedExact(c) ?? scry.cached(c);
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
function groupsOf(p: Precon, resolved: boolean): { deck: Group[]; side: Group[] } {
  const all = deckCards(p);
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

function PreconList({ precon, addButton, onClose }: { precon: Precon; addButton: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [view, setView] = usePreconView();
  // undefined while Scryfall loads; false if it couldn't (names only).
  const [resolved, setResolved] = useState<boolean | undefined>(undefined);
  const preview = useCardPreview();
  useEffect(() => ref.current?.showModal(), []);
  useEffect(() => {
    let live = true;
    scry.resolve(deckCards(precon)).then(() => live && setResolved(true), () => live && setResolved(false));
    return () => {
      live = false;
    };
  }, [precon]);

  const { deck, side } = useMemo(() => groupsOf(precon, resolved === true), [precon, resolved]);

  const details = (s: scry.ScryCard) => {
    preview.hide();
    showCardDetails(s);
  };

  /** Cards overlap so only their name bars show; hover shows the whole card, click opens details. */
  const stack = (g: Group) => (
    <div key={g.key} className="stack-col">
      <h4>{g.label}<span className="muted"> {total(g.cards)}</span></h4>
      <div className="stack">
        {g.cards.map((c) => {
          const s = lookup(c);
          const img = s && scry.imageUrl(s, "normal");
          return (
            <button key={c.name} className="stack-card" title={s ? undefined : c.name} disabled={!s} onClick={() => s && details(s)} aria-label={`${c.quantity} × ${c.name}: card details`} {...preview.handlers(s)}>
              {img ? <img src={img} alt="" loading="lazy" /> : <span className="noimg">{c.name}</span>}
              {img && <span className="tile-name" aria-hidden="true">{c.name}</span>}
              {c.quantity > 1 && <span className="stack-qty">×{c.quantity}</span>}
            </button>
          );
        })}
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
              {s ? <button className="cname" title="Card details" onClick={() => details(s)}>{c.name}</button> : <span className="cname">{c.name}</span>}
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
        {view === "stacks" ? <div className="stack-groups">{groups.map(stack)}</div> : <div className="type-groups">{groups.map(list)}</div>}
      </section>
    );

  return (
    <dialog ref={ref} className="printings precon-dialog" onClose={onClose} onClick={(e) => closeOnBackdrop(e.nativeEvent, ref.current)}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <div className="dialog-head">
        <div>
          <h3>{precon.name}</h3>
          <p className="muted small">{precon.setName} · {releaseLabel(precon.date) || "Undated"} · {cardCount(precon)} cards</p>
        </div>
        <div className="actions">
          <div className="view-toggle" role="group" aria-label="Show the deck as">
            <button aria-pressed={view === "stacks"} onClick={() => setView("stacks")}>▦ Cards</button>
            <button aria-pressed={view === "list"} onClick={() => setView("list")}>☰ List</button>
          </div>
          {addButton}
        </div>
      </div>
      <div className="precon-list" onScroll={preview.hide}>
        {precon.description && <p className="muted">{precon.description}</p>}
        {resolved === undefined ? (
          <Loading />
        ) : (
          <>
            {resolved === false && <p className="muted small">Couldn't reach Scryfall, so only card names are shown.</p>}
            {section("Deck", deck)}
            {section("Sideboard", side)}
          </>
        )}
      </div>
      {preview.element}
    </dialog>
  );
}
