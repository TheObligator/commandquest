// Decks → Browse: everyone's public decks (or your favorites), searched by name or author,
// commander, cards, format, colors and bracket (convex/sharing.ts). The filters live in the URL,
// so a search can be shared and Back keeps it.
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { ColorMatch } from "../../convex/model/sharing";
import { navigate, useRoute } from "../app/router";
import { BRACKETS } from "../brackets";
import { DeckTabs } from "../components/DeckTabs";
import { Symbol } from "../components/ManaCost";
import { CoverWait, DeckSkeletons } from "../components/Spinner";
import { CARD_LIST, FORMATS, formatLabel } from "../deckFormats";
import * as scry from "../scryfall";
import { compact, sharePath } from "../sharing";
import { longAgo } from "./DeckTable";
import { SearchBox } from "./EditorSearch";

type Sort = "updated" | "likes" | "views" | "name";
const SORTS: { id: Sort; label: string }[] = [
  { id: "updated", label: "Recently updated" },
  { id: "likes", label: "Most liked" },
  { id: "views", label: "Most viewed" },
  { id: "name", label: "Name" },
];
const COLORS = ["W", "U", "B", "R", "G", "C"];
const PAGE = 48;

/** The search in the URL. */
function read(q: URLSearchParams) {
  const colors = q.get("colors");
  return {
    text: q.get("q") ?? "",
    commander: q.get("cmdr") ?? "",
    cards: q.getAll("card"),
    format: q.get("format") ?? "",
    colors: colors ?? undefined,
    colorMatch: (["exact", "including", "within"].includes(q.get("cm") ?? "") ? q.get("cm") : "exact") as ColorMatch,
    bracket: Number(q.get("bracket")) || undefined,
    sort: (SORTS.some((s) => s.id === q.get("sort")) ? q.get("sort") : "updated") as Sort,
    favorites: q.get("fav") === "1",
  };
}
type Search = ReturnType<typeof read>;

function write(s: Search): string {
  const q = new URLSearchParams();
  if (s.text) q.set("q", s.text);
  if (s.commander) q.set("cmdr", s.commander);
  for (const c of s.cards) q.append("card", c);
  if (s.format) q.set("format", s.format);
  if (s.colors !== undefined) q.set("colors", s.colors);
  if (s.colors !== undefined && s.colorMatch !== "exact") q.set("cm", s.colorMatch);
  if (s.bracket) q.set("bracket", String(s.bracket));
  if (s.sort !== "updated") q.set("sort", s.sort);
  if (s.favorites) q.set("fav", "1");
  const qs = q.toString();
  return "/decks/browse" + (qs ? "?" + qs : "");
}

/** A text box that updates the search once typing pauses. */
function useTyped(value: string, onSettle: (v: string) => void): [string, (v: string) => void] {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = window.setTimeout(() => onSettle(text), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return [text, setText];
}

export function Browse() {
  const { query } = useRoute();
  const { isAuthenticated } = useConvexAuth();
  const s = read(query);
  const set = (c: Partial<Search>) => navigate(write({ ...s, ...c }), true);
  const [limit, setLimit] = useState(PAGE);
  const key = write(s);
  useEffect(() => setLimit(PAGE), [key]);

  // The colors in the search: "" means colorless; "C" on its own is how the buttons ask for it.
  const picked = new Set(s.colors === undefined ? [] : s.colors === "" ? ["C"] : [...s.colors]);
  const toggleColor = (c: string) => {
    const next = new Set(picked);
    if (c === "C") {
      if (next.has("C")) next.delete("C");
      else next.clear(), next.add("C");
    } else {
      next.delete("C");
      if (next.has(c)) next.delete(c);
      else next.add(c);
    }
    set({ colors: next.size === 0 ? undefined : next.has("C") ? "" : [...next].join("") });
  };

  const result = useQuery(api.sharing.search, s.favorites && !isAuthenticated ? "skip" : {
    text: s.text || undefined,
    commander: s.commander || undefined,
    cards: s.cards.length ? s.cards : undefined,
    format: s.format || undefined,
    colors: s.colors,
    colorMatch: s.colorMatch,
    bracket: s.bracket,
    favorites: s.favorites || undefined,
    sort: s.sort,
    limit,
  });
  const favorites = useQuery(api.sharing.favoriteKeys, isAuthenticated ? {} : "skip");
  const favSet = new Set(favorites ?? []);

  const [text, setText] = useTyped(s.text, (v) => set({ text: v.trim() }));
  const [commander, setCommander] = useTyped(s.commander, (v) => set({ commander: v.trim() }));

  const [artLoaded, setArtLoaded] = useState("");
  const coverIds = (result?.decks ?? []).map((d) => d.coverScryfallId).filter((id): id is string => !!id);
  const coverKey = coverIds.join(",");
  useEffect(() => {
    if (!coverIds.length) return;
    scry.cardsById(coverIds).catch(() => undefined).finally(() => setArtLoaded(coverKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverKey]);

  const filtered = !!(s.text || s.commander || s.cards.length || s.format || s.colors !== undefined || s.bracket);
  const addCard = (name: string) => {
    const n = name.trim();
    if (n && !s.cards.some((c) => c.toLowerCase() === n.toLowerCase())) set({ cards: [...s.cards, n].slice(0, 10) });
  };

  return (
    <>
      <div className="page-head row">
        <DeckTabs current="browse" />
        <div className="browse-scope" role="group" aria-label="Which decks">
          <button aria-pressed={!s.favorites} onClick={() => set({ favorites: false })}>All public</button>
          <button aria-pressed={s.favorites} onClick={() => (isAuthenticated ? set({ favorites: true }) : navigate(`/signin?next=${encodeURIComponent(write({ ...s, favorites: true }))}`))}>
            <span aria-hidden="true">★</span> My favorites
          </button>
        </div>
      </div>

      <div className="browse-filters card">
        <label className="bf-text">
          <span>Deck name or author</span>
          <input type="search" value={text} placeholder="e.g. superfriends, or a username" maxLength={100} onChange={(e) => setText(e.target.value)} />
        </label>
        <label className="bf-cmdr">
          <span>Commander</span>
          <input type="search" value={commander} placeholder="e.g. Atraxa" maxLength={100} onChange={(e) => setCommander(e.target.value)} />
        </label>
        <label className="bf-format">
          <span>Format</span>
          <select value={s.format} onChange={(e) => set({ format: e.target.value })}>
            <option value="">Any format</option>
            {FORMATS.map((f) => <option key={f} value={f}>{formatLabel(f)}</option>)}
          </select>
        </label>
        <label className="bf-bracket">
          <span>Bracket</span>
          <select value={s.bracket ?? ""} onChange={(e) => set({ bracket: Number(e.target.value) || undefined })}>
            <option value="">Any bracket</option>
            {BRACKETS.map((b) => <option key={b.n} value={b.n}>{b.n} · {b.name}</option>)}
          </select>
        </label>
        <div className="bf-cards">
          <span className="bf-label">Has these cards (all of them)</span>
          <div className="bf-card-box">
            {s.cards.map((c) => (
              <button key={c} className="chip removable" title={`Take ${c} out of the search`} onClick={() => set({ cards: s.cards.filter((x) => x !== c) })}>
                {c} <span aria-hidden="true">×</span>
              </button>
            ))}
            {s.cards.length < 10 && <SearchBox onPick={addCard} onSubmit={addCard} placeholder="Add a card…" label="Add a card to the search" />}
          </div>
        </div>
        <div className="bf-colors">
          <span className="bf-label">Colors</span>
          <div className="row">
            <div className="color-picks" role="group" aria-label="Colors">
              {COLORS.map((c) => (
                <button key={c} className={`color-pick${picked.has(c) ? " on" : ""}`} aria-pressed={picked.has(c)} title={c === "C" ? "Colorless" : c} onClick={() => toggleColor(c)}>
                  <Symbol sym={c} />
                </button>
              ))}
            </div>
            {s.colors !== undefined && s.colors !== "" && (
              <select aria-label="How colors match" value={s.colorMatch} onChange={(e) => set({ colorMatch: e.target.value as ColorMatch })}>
                <option value="exact">Exactly</option>
                <option value="including">Including</option>
                <option value="within">At most</option>
              </select>
            )}
          </div>
        </div>
      </div>

      <div className="deck-bar-row">
        <h2>
          {result === undefined ? "Searching…" : `${result.decks.length}${result.more ? "+" : ""} deck${result.decks.length === 1 ? "" : "s"}`}
        </h2>
        {filtered && <button className="btn ghost small" onClick={() => navigate(write({ ...read(new URLSearchParams()), favorites: s.favorites, sort: s.sort }), true)}>Clear filters</button>}
        <div className="deck-show">
          <select aria-label="Sort by" value={s.sort} onChange={(e) => set({ sort: e.target.value as Sort })}>
            {SORTS.map((x) => <option key={x.id} value={x.id}>Sort: {x.label}</option>)}
          </select>
        </div>
      </div>

      {result === undefined ? (
        <DeckSkeletons n={9} text="Searching decks…" />
      ) : !result.decks.length ? (
        <div className="empty card">
          {s.favorites ? (
            <>
              <h3>{filtered ? "None of your favorites match" : "No favorites yet"}</h3>
              <p>Open a shared deck and click ☆ Favorite to keep it here.</p>
            </>
          ) : (
            <>
              <h3>{filtered ? "No public decks match" : "No public decks yet"}</h3>
              <p>{filtered ? "Try fewer filters." : "Decks show up here when their owners share them publicly."}</p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="deck-grid">
            {result.decks.map((d) => {
              const card = d.coverScryfallId ? scry.cachedById(d.coverScryfallId) : undefined;
              const art = card && (card.card_faces?.[0]?.image_uris?.art_crop ?? card.image_uris?.art_crop);
              return (
                <a key={d.key} className="deck-tile browse-tile" href={`#${sharePath(d.key)}`}>
                  <div className="deck-cover" style={art ? { backgroundImage: `url("${art}")` } : undefined}>
                    <CoverWait src={art || undefined} pending={!!d.coverScryfallId && !card && artLoaded !== coverKey} />
                    {art && <span className="art-credit">Art by {scry.artistOf(card!) ?? "unknown"} · © Wizards of the Coast</span>}
                    {favSet.has(d.key) && <span className="tile-fav" title="In your favorites">★</span>}
                  </div>
                  <div className="deck-meta">
                    <h3>{d.name}</h3>
                    {d.format !== CARD_LIST && <p>{d.commanders.length ? d.commanders.join(" & ") : formatLabel(d.format)}</p>}
                    <p className="muted small">
                      by {d.author ?? "a player"}
                      {d.format === "commander" && d.bracket ? ` · B${d.bracket}` : ""} · {d.cardCount} cards · {longAgo(d.updatedAt)}
                    </p>
                    {s.cards.length > 0 && <p className="small browse-hit">✓ {s.cards.join(", ")}</p>}
                    <p className="muted small browse-stats">
                      {d.colors !== undefined && <span className="dt-pips">{[...(d.colors || "C")].map((c) => <Symbol key={c} sym={c} />)}</span>}
                      <span title="Likes">♥ {compact(d.likes)}</span>
                      <span title="Views">👁 {compact(d.views)}</span>
                      <span title="Comments">💬 {compact(d.comments)}</span>
                    </p>
                  </div>
                </a>
              );
            })}
          </div>
          {result.more && limit < 120 && (
            <div className="actions browse-more"><button className="btn ghost" onClick={() => setLimit((l) => Math.min(120, l + PAGE))}>Show more</button></div>
          )}
          {result.more && limit >= 120 && <p className="muted small">Showing the first 120. Add a filter to narrow it down.</p>}
        </>
      )}
    </>
  );
}
