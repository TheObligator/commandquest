// The deck editor's Packages tab: your packages, how many of each one's cards fit this deck, a
// button that adds those, and a window to look one over first (and take off-color cards anyway).
import { useEffect, useMemo, useRef, useState } from "react";
import type { Board, DeckCard } from "../../convex/model/deckRules";
import { closeOnBackdrop } from "../carddetails";
import { formatLabel, hasCommander, isPlainList } from "../deckFormats";
import { copiesIn, packageColors, planPackage, type PackageEntry, type PackageFit } from "../packages";
import * as scry from "../scryfall";
import { boardsFor } from "../pages/boards";
import { cardData, isKnown, usePackages, type Package } from "../usePackages";
import { CardImg, CardNone, CardWait } from "./CardImg";
import { ManaCost } from "./ManaCost";
import { ScryfallWaiting, Waiting } from "./Spinner";

export interface DeckForPackages {
  name: string;
  format: string;
  cards: DeckCard[];
  extraColor?: string;
}

/** Adds these cards to a board, tagged with `tag` if there is one. */
export type AddPackage = (entries: PackageEntry[], board: Board, packageName: string, tag?: string) => void;

const symbols = (colors: string[]) => (colors.length ? colors : ["C"]).map((x) => `{${x}}`).join("");

/** The deck's commanders' colors, or null when nothing limits its colors. Undefined: not known yet. */
function commanderColors(deck: DeckForPackages): string[] | null | undefined {
  const cmdrs = hasCommander(deck.format) ? deck.cards.filter((c) => c.board === "commander") : [];
  if (!cmdrs.length) return null;
  const cards = cmdrs.map(cardData);
  if (cards.some((c) => !c)) return undefined;
  return [..."WUBRG"].filter((x) => cards.some((c) => c!.color_identity.includes(x)));
}

export function PackagesPane({ hidden, deck, onAdd }: { hidden: boolean; deck: DeckForPackages; onAdd: AddPackage }) {
  const { packages, data, retry } = usePackages();
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const colors = commanderColors(deck);
  const shown = (packages ?? []).filter((p) => `${p.name} ${p.note ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const opened = packages?.find((p) => p._id === open);

  return (
    <div className="pane packages-pane" hidden={hidden}>
      {packages === undefined ? (
        <Waiting text="Loading your packages…" />
      ) : packages.length === 0 ? (
        <p className="muted small">No packages yet. A package is a set of cards you use in many decks. Make one with Create at the top of the page, or right-click a card here and choose “Add to package…”.</p>
      ) : (
        <>
          {packages.length > 5 && <input type="search" placeholder="Filter packages…" aria-label="Filter packages" value={filter} onChange={(e) => setFilter(e.target.value)} />}
          {data === "failed" && <p className="form-error small">Couldn't load some cards from Scryfall. <button className="text-link" onClick={retry}>Try again</button></p>}
          {colors === undefined && <p className="form-error small">Your commander's colors aren't known yet, so packages can't be checked.</p>}
          {filter.trim() && !shown.length && <p className="muted small">No packages match “{filter.trim()}”.</p>}
          <ul className="package-rows">
            {shown.map((p) => (
              <PackageRow key={p._id} pkg={p} deck={deck} ready={colors !== undefined && isKnown(p, data)} loading={data === "loading"} onOpen={() => setOpen(p._id)} onAdd={onAdd} />
            ))}
          </ul>
        </>
      )}
      <a href="#/decks/packages" className="link small">Manage packages</a>
      {opened && <PackageDialog pkg={opened} deck={deck} ready={colors !== undefined && isKnown(opened, data)} loading={data === "loading"} colors={colors ?? null} onAdd={onAdd} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** "6 of 10 fit, 2 already in". */
function summary(entries: PackageEntry[], deck: DeckForPackages): string {
  if (!entries.length) return "No cards yet";
  const n = (f: PackageFit) => entries.filter((e) => e.fit === f).length;
  const limited = hasCommander(deck.format) || !isPlainList(deck.format);
  const fitting = n("fits") + n("have");
  const fit = fitting === entries.length ? `${entries.length} card${entries.length === 1 ? "" : "s"}` : `${fitting} of ${entries.length} ${limited ? "fit" : "can be added"}`;
  return fit + (!n("have") ? "" : n("fits") ? `, ${n("have")} already in` : ", already in");
}

function PackageRow({ pkg, deck, ready, loading, onOpen, onAdd }: { pkg: Package; deck: DeckForPackages; ready: boolean; loading: boolean; onOpen: () => void; onAdd: AddPackage }) {
  const entries = planPackage(pkg.cards, deck, cardData);
  const fits = entries.filter((e) => e.fit === "fits");
  const first = pkg.cards[0] && cardData(pkg.cards[0]);
  const img = first && scry.imageUrl(first, "small");
  return (
    <li className="package-row">
      <button className="package-open" disabled={!pkg.cards.length} title={`Look through ${pkg.name}`} onClick={onOpen}>
        <span className="package-thumb">{img && <CardImg tiny src={img} name="" alt="" loading="lazy" />}</span>
        <span className="package-text">
          <strong>{pkg.name}</strong>
          <span className="muted small package-line">
            {ready ? <>{pkg.cards.length > 0 && <ManaCost cost={symbols(packageColors(pkg.cards, cardData))} />}{summary(entries, deck)}</> : loading ? <ScryfallWaiting text="Checking its cards…" still="Still checking." /> : `${pkg.cards.length} cards`}
          </span>
        </span>
      </button>
      {ready && fits.length > 0 && <button className="btn small" aria-label={`Add ${copiesIn(fits)} cards from ${pkg.name}`} onClick={() => onAdd(fits, "main", pkg.name)}>+ Add {copiesIn(fits)}</button>}
      {ready && !fits.length && entries.some((e) => e.fit === "have") && <span className="package-done small">✓ Added</span>}
    </li>
  );
}

function PackageDialog(props: { pkg: Package; deck: DeckForPackages; ready: boolean; loading: boolean; colors: string[] | null; onAdd: AddPackage; onClose: () => void }) {
  const { pkg, deck, ready, colors } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const [board, setBoard] = useState<Board>("main");
  const [tag, setTag] = useState(false);
  /** Cards whose box differs from the default (checked for what fits, unchecked for the rest). */
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => ref.current?.showModal(), []);

  const entries = useMemo(() => planPackage(pkg.cards, deck, cardData, board), [pkg.cards, deck, board, ready]);
  const picked = (e: PackageEntry) => e.copies > 0 && (e.fit === "fits") !== flipped.has(e.card.name);
  const chosen = entries.filter(picked);
  const noun = isPlainList(deck.format) ? "list" : "deck";
  const n = copiesIn(chosen);
  const of = (f: PackageFit) => entries.filter((e) => e.fit === f);
  const offPicked = chosen.filter((e) => e.fit === "off").length;
  const illegalPicked = chosen.filter((e) => e.fit === "illegal").length;

  const toggle = (name: string) =>
    setFlipped((was) => {
      const next = new Set(was);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  /** Checks or unchecks a whole group. */
  const setAll = (group: PackageEntry[], on: boolean) =>
    setFlipped((was) => {
      const next = new Set(was);
      for (const e of group) if ((e.fit === "fits") !== on) next.add(e.card.name); else next.delete(e.card.name);
      return next;
    });

  const group = (f: PackageFit, title: React.ReactNode, className = "") => {
    const cards = of(f);
    if (!cards.length) return null;
    const allOn = cards.every(picked);
    return (
      <section className={`package-group ${className}`}>
        <h4>
          <span>{title}<span className="muted"> {cards.length}</span></span>
          {f !== "have" && <button type="button" className="text-link small" onClick={() => setAll(cards, !allOn)}>{allOn ? "Uncheck all" : "Check all"}</button>}
        </h4>
        <div className="package-cards">
          {cards.map((e) => {
            const s = cardData(e.card);
            const img = s && scry.imageUrl(s, "normal");
            const on = picked(e);
            const pic = img ? <CardImg src={img} name={e.card.name} alt={e.card.name} loading="lazy" /> : props.loading ? <CardWait name={e.card.name} /> : <CardNone name={e.card.name} />;
            const label = `${e.copies > 1 ? `${e.copies} × ` : ""}${e.card.name}`;
            return f === "have" ? (
              <div key={e.card.name} className="package-card have" title={`${e.card.name}: already in the ${noun}`}>{pic}</div>
            ) : (
              <label key={e.card.name} className={`package-card${on ? " on" : ""}`} title={label}>
                <input type="checkbox" checked={on} aria-label={label} onChange={() => toggle(e.card.name)} />
                {pic}
                {e.copies > 1 && <span className="tile-qty">×{e.copies}</span>}
              </label>
            );
          })}
        </div>
      </section>
    );
  };

  return (
    <dialog ref={ref} className="new-deck package-dialog" onClose={props.onClose} onClick={(e) => closeOnBackdrop(e.nativeEvent, ref.current)}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <h3>Add “{pkg.name}” to {deck.name}</h3>
      {!ready ? (
        props.loading ? <p><ScryfallWaiting text="Checking its cards…" still="Still checking its cards." /></p> : <p className="form-error">Couldn't look up its cards on Scryfall.</p>
      ) : (
        <div className="package-body">
          {group("fits", colors ? <>Fits your commander <ManaCost cost={symbols(colors)} /></> : "Cards")}
          {group("off", "Outside your commander's colors", "warn")}
          {group("illegal", `Not legal in ${formatLabel(deck.format)}`, "warn")}
          {group("unknown", "Not found on Scryfall", "warn")}
          {group("have", `Already in the ${noun}`)}
        </div>
      )}
      <div className="package-foot">
        {(offPicked > 0 || illegalPicked > 0) && (
          <p className="package-warning small" role="status">
            ⚠ {[
              offPicked > 0 && `${offPicked} card${offPicked === 1 ? " is" : "s are"} outside your commander's colors`,
              illegalPicked > 0 && `${illegalPicked} ${illegalPicked === 1 ? "isn't" : "aren't"} legal in ${formatLabel(deck.format)}`,
            ].filter(Boolean).join(", and ")}.
          </p>
        )}
        {boardsFor(deck.format).length > 1 && (
          <label className="inline small muted">
            Add to{" "}
            <select value={board} onChange={(e) => setBoard(e.target.value as Board)}>
              {boardsFor(deck.format).filter((b) => b.id !== "commander").map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </label>
        )}
        <label className="inline small muted"><input type="checkbox" checked={tag} onChange={(e) => setTag(e.target.checked)} /> Tag them “{pkg.name}”</label>
        <span className="spacer" />
        <button className="btn ghost" onClick={() => ref.current?.close()}>Cancel</button>
        <button
          className="btn"
          disabled={!ready || !n}
          onClick={() => {
            props.onAdd(chosen, board, pkg.name, tag ? pkg.name : undefined);
            ref.current?.close();
          }}
        >
          Add {n} card{n === 1 ? "" : "s"}
        </button>
      </div>
    </dialog>
  );
}
