// The deck editor's Tokens section: every token the deck makes, with the printing games will use.
// Click one to pick another printing for this deck (stored in Convex; "Default" goes back).
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { DeckCard } from "../../convex/model/deckRules";
import { errorMessage } from "../app/errors";
import { closeOnBackdrop } from "../carddetails";
import { toast } from "../dom";
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
      <section className="board deck-tokens">
        <h2>Tokens</h2>
        <p className="muted small">Finding the tokens this deck makes…</p>
      </section>
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
    <section className="board deck-tokens">
      <h2>
        Tokens<span className="muted"> {tokens.length}</span>
      </h2>
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
              {img ? <img src={img} alt={t.name} loading="lazy" /> : <span className="token-pick-name">{t.name}</span>}
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
    </section>
  );
}

function ptOf(t: DeckToken) {
  const pt = t.identity.split("|")[2];
  return pt && pt !== "-" ? pt : "";
}

/** Printings of one token: the deck's own sources first, then every other printing on Scryfall. */
function TokenPrintings({ token, onPick, onClose }: { token: DeckToken; onPick: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [prints, setPrints] = useState<scry.ScryCard[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
    const [, colors, pt] = token.identity.split("|");
    const [p, t] = pt === "-" ? [] : pt.split("/");
    const q = `t:token !"${token.name.replace(/"/g, "")}"${colors ? ` c=${colors.toLowerCase()}` : " c=c"}${p !== undefined ? ` pow=${p} tou=${t}` : ""}`;
    scry
      .search(q, "prints")
      .then((page) => {
        const own = token.sources.map((s) => scry.cachedById(s.tokenId)).filter((c): c is scry.ScryCard => !!c);
        const seen = new Set(own.map((c) => c.id));
        setPrints([...own, ...page.cards.filter((c) => !seen.has(c.id))]);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [token.identity]); // eslint-disable-line react-hooks/exhaustive-deps

  const fromCard = (id: string) => token.sources.find((s) => s.tokenId === id)?.card;
  return (
    <dialog ref={ref} className="printings" onClose={onClose} onClick={(e) => closeOnBackdrop(e.nativeEvent, ref.current)}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <div className="dialog-head">
        <h3>{token.name} token</h3>
      </div>
      {error ? <p className="form-error">{error}</p> : !prints ? <p className="muted">Loading…</p> : (
        <div className="results">
          {prints.map((p) => (
            <button
              key={p.id}
              className={p.id === token.id ? "result-img selected" : "result-img"}
              title={`${p.set_name} #${p.collector_number}`}
              onClick={() => {
                onPick(p.id);
                ref.current?.close();
              }}
            >
              <img src={scry.imageUrl(p, "normal") ?? ""} alt={p.set_name} loading="lazy" />
              <span className="small muted">
                {p.set.toUpperCase()} #{p.collector_number}
                {p.id === token.defaultId && " · default"}
              </span>
              {fromCard(p.id) && <span className="small muted">from {fromCard(p.id)}</span>}
              {scry.artistOf(p) && <span className="small muted">{scry.artistOf(p)}</span>}
            </button>
          ))}
        </div>
      )}
    </dialog>
  );
}
