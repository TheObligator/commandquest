// The Packages tab of the Decks page: sets of cards you keep to add to decks.
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { errorMessage } from "../app/errors";
import { CardMenu } from "../components/CardMenu";
import { CardImg, CardNone, CardWait } from "../components/CardImg";
import { DeckTabs } from "../components/DeckTabs";
import { ManaCost } from "../components/ManaCost";
import { Loading } from "../components/Spinner";
import { toast } from "../dom";
import { packageColors } from "../packages";
import * as scry from "../scryfall";
import { cardData, isKnown, usePackages, type Package } from "../usePackages";
import { ago } from "./DeckList";
import { NewPackageDialog } from "./NewPackageDialog";

/** How many of its cards a package's tile shows. */
const SHOWN = 4;

export function Packages() {
  const { packages, data, retry } = usePackages();
  const [creating, setCreating] = useState(false);
  const createPackage = useMutation(api.packages.create);
  const removePackage = useMutation(api.packages.remove);

  async function copy(p: Package) {
    try {
      await createPackage({ name: `${p.name} copy`.slice(0, 60), note: p.note, cards: p.cards });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function remove(p: Package) {
    if (!confirm(`Delete the package "${p.name}"? Decks you added it to keep their cards.`)) return;
    try {
      await removePackage({ id: p._id });
      toast("Package deleted");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const actions = (
    <div className="actions">
      <a href="#/decks/packages/new?import=1" className="btn ghost">Import list</a>
      <button className="btn" onClick={() => setCreating(true)}>+ New package</button>
    </div>
  );

  return (
    <>
      <div className="page-head row">
        <DeckTabs current="packages" />
        {actions}
      </div>
      {packages === undefined ? (
        <Loading text="Loading your packages…" />
      ) : packages.length === 0 ? (
        <div className="empty card">
          <h3>No packages yet</h3>
          <p>A package is a set of cards you use in many decks, like your ramp or your favorite removal. Add one to a deck and it brings the cards that fit the commander's colors.</p>
          {actions}
        </div>
      ) : (
        <>
          {data === "failed" && <p className="form-error small">Couldn't load some cards from Scryfall. <button className="text-link" onClick={retry}>Try again</button></p>}
          <div className="deck-grid">
            {packages.map((p) => {
              const colors = packageColors(p.cards, cardData);
              const n = p.cards.reduce((sum, c) => sum + c.quantity, 0);
              return (
                <div key={p._id} className="deck-tile-wrap">
                  <CardMenu
                    label={`Options for ${p.name}`}
                    className="deck-tile-menu"
                    sections={[{ items: [{ label: "Duplicate", onSelect: () => void copy(p) }, { label: "Delete package", danger: true, onSelect: () => void remove(p) }] }]}
                  />
                  <a className="deck-tile" href={`#/decks/packages/${p._id}`}>
                    {/* Whole cards side by side: their artist lines stay visible (Scryfall's image rules). */}
                    <div className="package-cover">
                      {p.cards.length === 0 && <span className="muted small">No cards yet</span>}
                      {p.cards.slice(0, SHOWN).map((c) => {
                        const s = cardData(c);
                        const img = s && scry.imageUrl(s, "small");
                        return <div key={c.name}>{img ? <CardImg tiny src={img} name={c.name} alt={c.name} loading="lazy" /> : data === "loading" ? <CardWait name={c.name} /> : <CardNone name={c.name} why="" />}</div>;
                      })}
                    </div>
                    <div className="deck-meta">
                      <h3>{p.name}</h3>
                      {p.note && <p>{p.note}</p>}
                      <p className="muted small package-line">
                        {isKnown(p, data) && p.cards.length > 0 && <ManaCost cost={(colors.length ? colors : ["C"]).map((x) => `{${x}}`).join("")} />}
                        {n} card{n === 1 ? "" : "s"} · {ago(p.updatedAt)}
                      </p>
                    </div>
                  </a>
                </div>
              );
            })}
          </div>
        </>
      )}
      {creating && <NewPackageDialog onClose={() => setCreating(false)} />}
    </>
  );
}
