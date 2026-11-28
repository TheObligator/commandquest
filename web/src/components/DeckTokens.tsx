// The deck editor's Tokens section: every token the deck makes, with the printing games will use.
// Click one to pick another printing for this deck (stored in Convex; "Default" goes back).
import { FoldSection } from "./Collapsible";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { DeckCard } from "../../convex/model/deckRules";
import { errorMessage } from "../app/errors";
import { closeOnBackdrop } from "../carddetails";
import { toast } from "../dom";
import { CardImg, CardWait } from "./CardImg";
import { KnownPrintings } from "./KnownPrintings";
import { MorePrintings, useShownPrintings } from "./MorePrintings";
import { ScryfallWaiting, Waiting } from "./Spinner";
import * as scry from "../scryfall";
import type { DeckToken } from "../tokens";
import { useDeckTokens } from "../useDeckTokens";

export function DeckTokens({ deckId, cards }: { deckId?: string; cards: DeckCard[] }) {
  const saved = useQuery(api.decks.get, deckId ? { id: deckId } : "skip");
  const { tokens, loading } = useDeckTokens(cards, saved?.tokenArt);
  const [picking, setPicking] = useState<DeckToken | null>(null);
  const setTokenArt = useMutation(api.decks.setTokenArt);

  if (!tokens.length) {
    return loading ? (
      <FoldSection id="tokens" className="deck-tokens" title="Tokens">
        <p className="small"><Waiting text="Finding the tokens this deck makes…" slow="Still finding the tokens this deck makes… Scryfall is slow right now." /></p>
      </FoldSection>
    ) : null;
  }

  async function pick(t: DeckToken, id: string | null) {
    if (!deckId) return toast("Save the deck first.", "error");
    try {
      await setTokenArt({ id: deckId as Id<"decks">, identity: t.identity, scryfallId: id === t.defaultId ? null : id });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <FoldSection id="tokens" className="deck-tokens" title={<>Tokens<span className="muted"> {tokens.length}</span></>}>
      <p className="muted small">
        The tokens this deck makes, with the art games use. By default that's the commander's version, else the newest card's. Click one to
        pick another printing for this deck.
      </p>
      <div className="card-tiles">
        {tokens.map((t) => {
          const sc = scry.cachedById(t.id);
          const img = sc && scry.imageUrl(sc, "normal");
          return (
            <button key={t.identity} className="token-pick" onClick={() => setPicking(t)} title={`Made by ${t.sources.map((s) => s.card).join(", ")}`}>
              {img ? <CardImg src={img} name={t.name} alt={t.name} loading="lazy" /> : !sc && loading ? <CardWait name={t.name} /> : <span className="token-pick-name">{t.name}</span>}
              <span className="small">
                {t.name} {ptOf(t)}
                {t.chosenId && <span className="muted"> · your pick</span>}
              </span>
              <span className="small muted">{sc ? `${sc.set.toUpperCase()} #${sc.collector_number}` : ""}</span>
            </button>
          );
        })}
      </div>
      {picking && (
        <TokenPrintings
          token={picking}
          onPick={(id) => void pick(picking, id)}
          onClose={() => setPicking(null)}
        />
      )}
    </FoldSection>
  );
}

function ptOf(t: DeckToken) {
  const pt = t.identity.split("|")[2];
  return pt && pt !== "-" ? pt : "";
}

/** The printings the deck's own cards make. Several often make the same one (Lathril's elves): listed once. */
function ownPrintings(token: DeckToken): scry.ScryCard[] {
  return [...new Set(token.sources.map((s) => s.tokenId))].map((id) => scry.cachedById(id)).filter((c): c is scry.ScryCard => !!c);
}

/** Printings of one token: the deck's own sources first, then every other printing on Scryfall. */
function TokenPrintings({ token, onPick, onClose }: { token: DeckToken; onPick: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [prints, setPrints] = useState<scry.ScryCard[] | null>(null);
  const [page, setPage] = useState<{ total: number; next?: string }>({ total: 0 });
  const [error, setError] = useState("");
  // A double-sided promo token with this one on the back (F17's Pirate // Treasure) matches a search for
  // Treasure, but shows its front: only printings whose front face is this token.
  const isThis = (c: scry.ScryCard) => (c.card_faces?.[0]?.name ?? c.name).toLowerCase() === token.name.toLowerCase();
  const { shown, more } = useShownPrintings(prints, token.id, page.total, page.next, isThis);
  useEffect(() => {
    ref.current?.showModal();
    const [, colors, pt] = token.identity.split("|");
    const [p, t] = pt === "-" ? [] : pt.split("/");
    const q = `t:token !"${token.name.replace(/"/g, "")}"${colors ? ` c=${colors.toLowerCase()}` : " c=c"}${p !== undefined ? ` pow=${p} tou=${t}` : ""}`;
    scry
      .search(q, "prints")
      .then((page) => {
        const own = ownPrintings(token);
        const seen = new Set(own.map((c) => c.id));
        const rest = page.cards.filter((c) => !seen.has(c.id) && isThis(c));
        setPrints([...own, ...rest]);
        setPage({ total: own.length + rest.length + (page.nextPage ? page.total - page.cards.length : 0), next: page.nextPage });
      })
      .catch((e) => setError(errorMessage(e)));
  }, [token.identity]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <dialog ref={ref} className="printings" onClose={onClose} onClick={(e) => closeOnBackdrop(e.nativeEvent, ref.current)}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <div className="dialog-head">
        <h3>{token.name} token</h3>
        {/* Up here, so the window doesn't get smaller when the list arrives. */}
        {!prints && !error && <span className="small"><ScryfallWaiting text="Finding its printings…" still="Still finding its printings." /></span>}
      </div>
      {error ? <p className="form-error">{error}</p> : !prints ? (
        <div className="results"><KnownPrintings cards={ownPrintings(token)} selected={token.id} /></div>
      ) : (
        <div className="results">
          {shown.map((p) => (
            <button
              key={p.id}
              className={p.id === token.id ? "result-img selected" : "result-img"}
              title={`${p.set_name} #${p.collector_number}`}
              onClick={() => {
                onPick(p.id);
                ref.current?.close();
              }}
            >
              <CardImg src={scry.imageUrl(p, "normal") ?? ""} name={p.set_name} alt={p.set_name} loading="lazy" />
              <span className="small muted">
                {p.set.toUpperCase()} #{p.collector_number}
                {p.id === token.defaultId && " · default"}
              </span>
              {scry.artistOf(p) && <span className="small muted">{scry.artistOf(p)}</span>}
            </button>
          ))}
          <MorePrintings {...more} />
        </div>
      )}
    </dialog>
  );
}
