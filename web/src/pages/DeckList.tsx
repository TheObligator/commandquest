import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { Loading } from "../components/Spinner";
import { artistOf, cachedById, cardsById } from "../scryfall";

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ago(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ms).toLocaleDateString();
}

export function DeckList() {
  const decks = useQuery(api.decks.list);
  const [, setArtLoaded] = useState(0);

  // Cover art is Scryfall's art crop of the commander. Scryfall requires the artist credit
  // wherever an art crop is shown, so each cover carries an "Art by …" caption.
  const coverIds = (decks ?? []).map((d) => d.coverScryfallId).filter((id): id is string => !!id);
  const coverKey = coverIds.join(",");
  useEffect(() => {
    if (!coverIds.length) return;
    cardsById(coverIds).then(() => setArtLoaded((n) => n + 1)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverKey]);

  const actions = (
    <div className="actions">
      <a href="#/decks/precons" className="btn ghost">Browse precons</a>
      <a href="#/decks/new?import=1" className="btn ghost">Import deck</a>
      <a href="#/decks/new" className="btn">+ New deck</a>
    </div>
  );

  return (
    <>
      <div className="page-head row">
        <h1>Your decks</h1>
        {actions}
      </div>
      {decks === undefined ? (
        <Loading />
      ) : decks.length === 0 ? (
        <div className="empty card">
          <h3>No decks yet</h3>
          <p>Start from scratch, copy a preconstructed deck, or bring a list over from Moxfield, Archidekt or a text file.</p>
          {actions}
        </div>
      ) : (
        <div className="deck-grid">
          {decks.map((d) => {
            const card = d.coverScryfallId ? cachedById(d.coverScryfallId) : undefined;
            const art = card && (card.card_faces?.[0]?.image_uris?.art_crop ?? card.image_uris?.art_crop);
            return (
              <a key={d._id} className="deck-tile" href={`#/decks/${d._id}`}>
                <div className="deck-cover" style={art ? { backgroundImage: `url("${art}")` } : undefined}>
                  {art && <span className="art-credit">Art by {artistOf(card!) ?? "unknown"} · © Wizards of the Coast</span>}
                </div>
                <div className="deck-meta">
                  <h3>{d.name}</h3>
                  <p>{d.commanders.length ? d.commanders.join(" & ") : "No commander"}</p>
                  <p className="muted small">{capitalize(d.format)} · {d.cardCount} cards · {ago(d.updatedAt)}</p>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}
