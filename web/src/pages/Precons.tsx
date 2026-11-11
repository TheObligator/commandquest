import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { DeckCard } from "../../convex/model/deckRules";
import { errorMessage } from "../app/errors";
import { closeOnBackdrop } from "../carddetails";
import { mergeDuplicates } from "../decklist";
import { toast } from "../dom";
import { Loading } from "../components/Spinner";
import { cardCount, deckCards, formatOf, loadPrecons, matches, releaseLabel, type Precon } from "../precons";
import * as scry from "../scryfall";

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
                <button className="deck-cover precon-cover" style={art ? { backgroundImage: `url("${art}")` } : undefined} onClick={() => setViewing(p)} aria-label={`View the ${p.name} decklist`}>
                  {art ? <span className="art-credit">Art by {scry.artistOf(card!) ?? "unknown"} · © Wizards of the Coast</span> : <span className="precon-set">{p.set.toUpperCase()}</span>}
                </button>
                <div className="deck-meta">
                  <h3>{p.name}</h3>
                  {p.commander.length > 0 && <p>{p.commander.map((c) => c[1]).join(" & ")}</p>}
                  <p className="muted small">{p.setName} · {releaseLabel(p.date) || "Undated"} · {cardCount(p)} cards</p>
                  <div className="actions precon-actions">
                    {addButton(p)}
                    <button className="btn ghost small" onClick={() => setViewing(p)}>View list</button>
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

const SECTIONS = [
  { key: "commander", label: "Commander" },
  { key: "main", label: "Main deck" },
  { key: "side", label: "Sideboard" },
] as const;

function PreconList({ precon, addButton, onClose }: { precon: Precon; addButton: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog ref={ref} className="printings precon-dialog" onClose={onClose} onClick={(e) => closeOnBackdrop(e.nativeEvent, ref.current)}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <div className="dialog-head">
        <div>
          <h3>{precon.name}</h3>
          <p className="muted small">{precon.setName} · {releaseLabel(precon.date) || "Undated"} · {cardCount(precon)} cards</p>
        </div>
        {addButton}
      </div>
      <div className="precon-list">
        {precon.description && <p className="muted">{precon.description}</p>}
        {SECTIONS.filter((s) => precon[s.key].length).map((s) => {
          // Forge lists basic lands once per art; show each name once.
          const merged = new Map<string, number>();
          for (const [n, name] of precon[s.key]) merged.set(name, (merged.get(name) ?? 0) + n);
          return (
            <section key={s.key} className="board">
              <h2>{s.label} ({[...merged.values()].reduce((a, b) => a + b, 0)})</h2>
              <ul className="flat">
                {[...merged].map(([name, n]) => (
                  <li key={name} className="card-row"><span className="qty">{n}</span><span className="cname">{name}</span></li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </dialog>
  );
}
