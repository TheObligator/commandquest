// A shared deck's page (`#/d/<key>`): the deck read-only, its likes, favorites and views, its
// changelog and comments. Open to anyone with the link while the deck is public or unlisted.
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { DeckCard } from "../../convex/model/deckRules";
import { errorMessage } from "../app/errors";
import { navigate } from "../app/router";
import { bracketName } from "../brackets";
import { CardViewToggle, useCardView } from "../cardView";
import { Changelog } from "../components/Changelog";
import { DeckComments } from "../components/DeckComments";
import { Symbol } from "../components/ManaCost";
import { ManaCurve } from "../components/ManaCurve";
import { ReadOnlyDeck, type Lookup } from "../components/ReadOnlyDeck";
import { ShareDialog } from "../components/ShareDialog";
import { BusyLabel, CoverWait, Loading } from "../components/Spinner";
import { CARD_LIST, formatLabel } from "../deckFormats";
import { writeDecklist } from "../decklist";
import { toast } from "../dom";
import * as scry from "../scryfall";
import { browserId, compact, copyText, VISIBILITY } from "../sharing";
import { longAgo } from "./DeckTable";

export function SharedDeck({ shareKey }: { shareKey: string }) {
  const deck = useQuery(api.sharing.get, { key: shareKey });
  const recordView = useMutation(api.social.recordView);
  const toggleLike = useMutation(api.social.toggleLike);
  const toggleFavorite = useMutation(api.social.toggleFavorite);
  const copyDeck = useMutation(api.sharing.copy);
  const [view, setView] = useCardView();
  const [tab, setTab] = useState<"deck" | "history">("deck");
  const [resolved, setResolved] = useState<boolean | undefined>(undefined);
  const [copying, setCopying] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [, bump] = useState(0);

  // One view per visit (the server counts each viewer once a day).
  useEffect(() => {
    recordView({ key: shareKey, browser: browserId() ?? undefined }).catch(() => undefined);
  }, [shareKey, recordView]);

  const cards = deck?.cards;
  useEffect(() => {
    if (!cards) return;
    let live = true;
    scry.resolve(cards).then(() => live && (setResolved(true), bump((n) => n + 1)), () => live && setResolved(false));
    return () => {
      live = false;
    };
  }, [cards]);

  const lookup = useCallback<Lookup>((c) => scry.cachedExact(c) ?? scry.cached(c), []);
  const curve = useMemo(
    () => (cards && resolved ? cards.filter((c) => c.board === "main" || c.board === "commander").flatMap((c) => (lookup(c) ? [{ name: c.name, quantity: c.quantity, card: lookup(c)! }] : [])) : []),
    [cards, resolved, lookup],
  );

  if (deck === undefined) return <Loading text="Opening the deck…" />;
  if (deck === null) {
    return (
      <div className="empty card">
        <h3>This deck isn't shared</h3>
        <p>Its owner made it private, or deleted it, or the link is wrong.</p>
        <div className="actions"><a href="#/decks/browse" className="btn">Browse decks</a></div>
      </div>
    );
  }

  const commanders = deck.cards.filter((c) => c.board === "commander");
  // The commander's art, as on the deck list (a card list: its first card's).
  const cover = commanders.find((c) => c.scryfallId) ?? commanders[0] ?? (deck.format === CARD_LIST ? deck.cards[0] : undefined);
  const coverCard = cover ? lookup(cover) : undefined;
  const art = coverCard && (coverCard.card_faces?.[0]?.image_uris?.art_crop ?? coverCard.image_uris?.art_crop);
  const count = deck.cards.filter((c) => c.board === "main" || c.board === "commander").reduce((n, c) => n + c.quantity, 0);
  const signInPath = `/signin?next=${encodeURIComponent(`/d/${shareKey}`)}`;

  async function copy() {
    if (!deck!.signedIn) return navigate(signInPath);
    setCopying(true);
    try {
      const id = await copyDeck({ key: shareKey });
      toast(`Copied ${deck!.name} to your decks`, "info", { label: "Open", run: () => navigate(`/decks/${id}`) });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setCopying(false);
    }
  }

  async function like() {
    if (!deck!.signedIn) return navigate(signInPath);
    try {
      await toggleLike({ key: shareKey });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function favorite() {
    if (!deck!.signedIn) return navigate(signInPath);
    try {
      const on = await toggleFavorite({ key: shareKey });
      toast(on ? "Added to your favorites (Decks → Browse → My favorites)" : "Taken out of your favorites");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  function download() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([writeDecklist(deck!.cards as DeckCard[])], { type: "text/plain" }));
    a.download = `${deck!.name.replace(/[^\w\- ]+/g, "").trim() || "deck"}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <div className="shared-deck">
      <a href="#/decks/browse" className="link small">← Browse decks</a>
      <header className="shared-head">
        <div className="deck-cover shared-cover" style={art ? { backgroundImage: `url("${art}")` } : undefined}>
          <CoverWait src={art || undefined} pending={!!cover && resolved === undefined} />
          {art && <span className="art-credit">Art by {scry.artistOf(coverCard!) ?? "unknown"} · © Wizards of the Coast</span>}
        </div>
        <div className="shared-title">
          <h1>{deck.name}</h1>
          <p className="muted">
            by <b className="shared-author">{deck.author ?? "a player"}</b> · {formatLabel(deck.format)}
            {deck.format === "commander" && deck.bracket ? ` · Bracket ${deck.bracket} (${bracketName(deck.bracket)})` : ""} · {count} cards · updated {longAgo(deck.updatedAt)}
          </p>
          <div className="shared-chips">
            {commanders.map((c) => <span key={c.name} className="chip">{c.name}</span>)}
            {deck.colors !== undefined && <span className="dt-pips">{[...(deck.colors || "C")].map((c) => <Symbol key={c} sym={c} />)}</span>}
            {deck.bracketTags?.map((t) => <span key={t} className="chip muted">{t}</span>)}
          </div>
        </div>
        <div className="shared-actions">
          <div className="actions">
            {deck.owner ? (
              <>
                <a className="btn" href={`#/decks/${deck.deckId}`}>Edit deck</a>
                <button className="btn ghost" onClick={() => setSharing(true)}>{VISIBILITY[deck.visibility].icon} {VISIBILITY[deck.visibility].label}</button>
              </>
            ) : (
              <button className="btn" disabled={copying} onClick={() => void copy()}><BusyLabel busy={copying} working="Copying…">Copy to my decks</BusyLabel></button>
            )}
            <details className="menu">
              <summary className="btn ghost">Export</summary>
              <div className="menu-list" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute("open")}>
                <button onClick={() => void copyText(writeDecklist(deck.cards as DeckCard[])).then((ok) => toast(ok ? "Decklist copied" : "Your browser blocked clipboard access. Use Download instead.", ok ? "info" : "error"))}>Copy decklist</button>
                <button onClick={download}>Download .txt</button>
                <button onClick={() => void copyText(location.href).then((ok) => toast(ok ? "Link copied" : "Couldn't copy the link", ok ? "info" : "error"))}>Copy link</button>
              </div>
            </details>
          </div>
          <div className="shared-stats">
            <button
              className={`stat-btn like${deck.liked ? " on" : ""}`}
              aria-pressed={deck.liked}
              disabled={deck.owner}
              title={deck.owner ? "Likes from other players" : deck.liked ? "Unlike" : "Like this deck"}
              onClick={() => void like()}
            >
              <span aria-hidden="true">{deck.liked ? "♥" : "♡"}</span> {compact(deck.likes)}
            </button>
            {!deck.owner && (
              <button className={`stat-btn fav${deck.favorited ? " on" : ""}`} aria-pressed={deck.favorited} title={deck.favorited ? "Take out of your favorites" : "Add to your favorites"} onClick={() => void favorite()}>
                <span aria-hidden="true">{deck.favorited ? "★" : "☆"}</span> {deck.favorited ? "Favorited" : "Favorite"}
              </button>
            )}
            <span className="stat-btn static" title="Viewers (each counted once a day)"><span aria-hidden="true">👁</span> {compact(deck.views)} view{deck.views === 1 ? "" : "s"}</span>
          </div>
        </div>
      </header>

      <div className="row shared-tabs">
        <div className="tabs">
          <button className={`tab${tab === "deck" ? " active" : ""}`} onClick={() => setTab("deck")}>Deck</button>
          <button className={`tab${tab === "history" ? " active" : ""}`} onClick={() => setTab("history")}>History</button>
        </div>
        {tab === "deck" && <CardViewToggle view={view} onChange={setView} />}
      </div>
      {tab === "deck" ? (
        <>
          <ReadOnlyDeck className="shared-list" cards={deck.cards as DeckCard[]} lookup={lookup} resolved={resolved} view={view} />
          {curve.length > 0 && <section className="shared-curve"><ManaCurve cards={curve} /></section>}
        </>
      ) : (
        <section className="shared-history">
          <p className="muted small">Each entry is one sitting: edits go together until an hour passes without one.</p>
          <Changelog shareKey={shareKey} />
        </section>
      )}
      <DeckComments shareKey={shareKey} commentsOff={deck.commentsOff} owner={deck.owner} />
      {sharing && deck.deckId && (
        <ShareDialog deck={{ _id: deck.deckId as Id<"decks">, name: deck.name, visibility: deck.visibility, shareKey, commentsOff: deck.commentsOff }} colors={deck.colors} onClose={() => setSharing(false)} />
      )}
    </div>
  );
}
