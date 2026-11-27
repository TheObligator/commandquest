import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { DeckCard } from "../../convex/model/deckRules";
import { errorMessage } from "../app/errors";
import { closeOnBackdrop } from "../carddetails";
import { CardViewToggle, useCardView } from "../cardView";
import { mergeDuplicates } from "../decklist";
import { toast } from "../dom";
import { ReadOnlyDeck, type Lookup } from "../components/ReadOnlyDeck";
import { BusyLabel, CoverWait, DeckSkeletons } from "../components/Spinner";
import { cardCount, cardImage, cardKey, deckCards, loadPreconCards, loadPrecons, matches, releaseLabel, type Precon, type PreconCardData } from "../precons";
import * as scry from "../scryfall";

type Kind = Precon["kind"];

/** Picks Scryfall printings (the precon's own set where Scryfall has it), so the deck shows art right away. */
async function withPrintings(p: Precon): Promise<DeckCard[]> {
  const cards = deckCards(p);
  try {
    // The baked card data already has the printings (see loadPreconCards).
    const baked = (await loadPreconCards(p)).cards;
    return mergeDuplicates(
      cards.map((c) => {
        const d = baked[cardKey(c.name, c.set, c.collectorNumber)];
        return d ? { ...c, scryfallId: d[0], set: d[1], collectorNumber: d[2] } : c;
      }),
    );
  } catch {
    // No baked data for this deck: ask Scryfall.
  }
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
  /** The covers whose cards have been looked up (found or not). */
  const [artLoaded, setArtLoaded] = useState("");
  const myDecks = useQuery(api.decks.list);
  const createDeck = useMutation(api.decks.create);

  useEffect(() => {
    loadPrecons().then(setPrecons).catch((e) => setError(errorMessage(e)));
  }, []);

  const shown = useMemo(() => (precons ?? []).filter((p) => p.kind === kind && matches(p, query)), [precons, kind, query]);
  const counts = useMemo(() => ({
    commander: (precons ?? []).filter((p) => p.kind === "commander").length,
    "secret-lair": (precons ?? []).filter((p) => p.kind === "secret-lair").length,
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
    scry.resolve(coverCards).catch(() => undefined).finally(() => setArtLoaded(coverKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverKey]);

  async function add(p: Precon) {
    setAdding((s) => new Set(s).add(p.id));
    try {
      const id = await createDeck({ name: p.name, format: "commander", cards: await withPrintings(p) });
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
        <BusyLabel busy={adding.has(p.id)} working="Adding…">Add to my decks</BusyLabel>
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
        <button role="tab" aria-selected={kind === "secret-lair"} className={kind === "secret-lair" ? "tab active" : "tab"} onClick={() => setKind("secret-lair")}>
          Secret Lair{precons ? ` (${counts["secret-lair"]})` : ""}
        </button>
      </div>
      <p className="muted small">Newest first. Adding a precon copies it into your decks, where you can edit it like any other deck.</p>
      {error ? (
        <p className="form-error">{error}</p>
      ) : !precons ? (
        <DeckSkeletons n={9} text="Loading the precons…" />
      ) : !shown.length ? (
        <div className="empty card"><h3>No precons match “{query}”</h3></div>
      ) : (
        <div className="deck-grid">
          {shown.map((p) => {
            const cmdr = p.commander[0];
            const card = cmdr ? scry.cachedInSet(cmdr[1], cmdr[2]) ?? scry.cached({ name: cmdr[1], quantity: 1, board: "commander" }) : undefined;
            const art = card && (card.card_faces?.[0]?.image_uris?.art_crop ?? card.image_uris?.art_crop);
            return (
              <div key={p.id} className="deck-tile precon-tile" onPointerEnter={() => void loadPreconCards(p).catch(() => undefined)}>
                <button className="deck-cover precon-cover" style={art ? { backgroundImage: `url("${art}")` } : undefined} onClick={() => setViewing(p)} aria-label={`View the ${p.name} deck`}>
                  <CoverWait src={art || undefined} pending={!!cmdr && !card && artLoaded !== coverKey} />
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

/** Enough of a Scryfall card to show and sort it, from the deck's baked data (no rules text). */
function bakedCard(name: string, [id, set, collectorNumber, cmc, typeLine, manaCost, back]: PreconCardData): scry.ScryCard {
  const uris = (b: boolean) => ({ small: cardImage(id, "small", b), normal: cardImage(id, "normal", b), large: cardImage(id, "large", b), art_crop: cardImage(id, "art_crop", b) });
  const card = { id, name, layout: "normal", cmc, type_line: typeLine, mana_cost: manaCost, set, set_name: "", collector_number: collectorNumber, rarity: "", scryfall_uri: "", legalities: {}, color_identity: [] } as scry.ScryCard;
  if (back) card.card_faces = [{ name, image_uris: uris(false) }, { name: "", image_uris: uris(true) }];
  else card.image_uris = uris(false);
  return card;
}
function PreconList({ precon, addButton, onClose }: { precon: Precon; addButton: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [view, setView] = useCardView();
  // undefined while the cards load; false if they couldn't (names only).
  const [resolved, setResolved] = useState<boolean | undefined>(undefined);
  const [baked, setBaked] = useState<Map<string, scry.ScryCard> | null>(null);
  const [opening, setOpening] = useState(false);
  useEffect(() => ref.current?.showModal(), []);
  useEffect(() => {
    let live = true;
    loadPreconCards(precon).then(
      (file) => {
        if (!live) return;
        setBaked(new Map(Object.entries(file.cards).flatMap(([k, d]) => (d ? [[k, bakedCard(k.split("|")[0], d)] as const] : []))));
        setResolved(true);
      },
      // No baked data (a deck newer than the last `npm run precons`): look the cards up on Scryfall.
      () => scry.resolve(deckCards(precon)).then(() => live && setResolved(true), () => live && setResolved(false)),
    );
    return () => {
      live = false;
    };
  }, [precon]);

  const lookup = useCallback<Lookup>((c) => baked?.get(cardKey(c.name, c.set, c.collectorNumber)) ?? scry.cachedExact(c) ?? scry.cached(c), [baked]);
  const cards = useMemo(() => deckCards(precon), [precon]);

  return (
    <dialog ref={ref} className={opening ? "printings precon-dialog opening" : "printings precon-dialog"} onClose={onClose} onClick={(e) => closeOnBackdrop(e.nativeEvent, ref.current)}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <div className="dialog-head">
        <div>
          <h3>{precon.name}</h3>
          <p className="muted small">{precon.setName} · {releaseLabel(precon.date) || "Undated"} · {cardCount(precon)} cards</p>
        </div>
        <div className="actions">
          <CardViewToggle view={view} onChange={setView} />
          {addButton}
        </div>
      </div>
      <ReadOnlyDeck className="precon-list" cards={cards} lookup={lookup} resolved={resolved} view={view} onOpening={setOpening}>
        {precon.description && <p className="muted">{precon.description}</p>}
      </ReadOnlyDeck>
    </dialog>
  );
}
