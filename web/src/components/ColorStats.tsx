// Under the deck stats: for each of W U B R G, the colored mana symbols on the deck's cards and
// how many of its lands make that color. Colors the deck doesn't use are greyed out.
import type { DeckCard } from "../../convex/model/deckRules";
import { WUBRG, colorPips, landSources, percent } from "../colorstats";
import * as scry from "../scryfall";

const NAMES = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" } as const;

const costOf = (s: scry.ScryCard) => s.mana_cost || s.card_faces?.map((f) => f.mana_cost ?? "").join("");

export function ColorStats({ cards, identity }: { cards: DeckCard[]; /** The commander's colors, in Commander-style decks. */ identity?: string[] }) {
  const played = cards.flatMap((c) => {
    const s = c.board === "main" || c.board === "commander" ? scry.cached(c) : undefined;
    return s ? [{ quantity: c.quantity, card: s, board: c.board }] : [];
  });
  const pips = colorPips(played.map((e) => ({ quantity: e.quantity, manaCost: costOf(e.card) })));
  const pipTotal = WUBRG.reduce((n, c) => n + pips[c], 0);
  const lands = landSources(
    played.filter((e) => e.board === "main" && scry.primaryType(e.card) === "Land").map((e) => ({ quantity: e.quantity, produced: e.card.produced_mana })),
  );
  const used = (c: string) => pips[c as keyof typeof pips] > 0 || !!identity?.includes(c);

  return (
    <section className="board color-stats">
      <h2>Colors</h2>
      <div className="color-grid">
        {WUBRG.map((c) => (
          <div key={c} className={`color-col${used(c) ? "" : " unused"}`}>
            <img className="color-sym" src={`https://svgs.scryfall.io/card-symbols/${c}.svg`} alt={NAMES[c]} title={NAMES[c]} />
            <div className="color-row" title={`${pips[c]} of the deck's ${pipTotal} colored mana symbols are ${NAMES[c].toLowerCase()}`}>
              <span className="color-big">{percent(pips[c], pipTotal)}</span>
              <span className="muted small">{pips[c]} symbol{pips[c] === 1 ? "" : "s"}</span>
            </div>
            <div className="color-row" title={`${lands.byColor[c]} of ${lands.total} lands can make ${NAMES[c].toLowerCase()} mana`}>
              <span className="color-big">{percent(lands.byColor[c], lands.total)}</span>
              <span className="muted small">{lands.byColor[c]} land{lands.byColor[c] === 1 ? "" : "s"}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="muted small color-note">
        Top: share of the colored mana symbols in the main deck's and commander's costs (hybrid counts for each color).
        Bottom: share of the main deck's {lands.total} lands that can make that color.
      </p>
    </section>
  );
}
