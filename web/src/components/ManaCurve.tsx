import { CardImg } from "./CardImg";
import { useState } from "react";
import * as scry from "../scryfall";
import { TYPE_ORDER } from "../deckGroups";
import { chanceOnCurve, playableLandBack } from "../deckstats";
import { useCardPreview } from "../useCardPreview";
import { ManaCost } from "./ManaCost";
import { TypeIcon } from "./TypeIcon";

type Entry = { name: string; quantity: number; card: scry.ScryCard };

/** Types in the chart, bottom of a bar first. Lands have no place on a mana curve. */
const TYPES = TYPE_ORDER.filter((t) => t !== "Land");
const COLUMNS = 8; // 0–6, then 7+
const EXAMPLES = 8;
const PICTURES = 4;

const label = (i: number) => (i === COLUMNS - 1 ? `${i}+` : String(i));
const swatch = (t: string) => ({ background: `var(--type-${t.toLowerCase()})` });
const total = (es: Entry[]) => es.reduce((n, e) => n + e.quantity, 0);

const pct = (p: number) => (p >= 0.9995 ? "100%" : p < 0.0005 ? "0%" : `${(p * 100).toFixed(1)}%`);
const COLOR_NAMES: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colorless" };

/**
 * The main deck's nonland cards by mana value, each bar split by card type. Hovering (or focusing)
 * one type's part of a bar shows that type's cards at that mana value, and how many of each other
 * type share it. Clicking a bar opens a breakdown of that mana value below the chart.
 */
export function ManaCurve({ cards }: { cards: Entry[] }) {
  const [open, setOpen] = useState<{ mv: number; type: string } | null>(null);
  /** The clicked mana value, broken down under the chart. */
  const [picked, setPicked] = useState<number | null>(null);
  const pick = (i: number) => setPicked((p) => (p === i ? null : i));
  // columns[mv][type] = the cards of that type at that mana value, most copies first
  const columns = Array.from({ length: COLUMNS }, () => new Map<string, Entry[]>());
  for (const e of cards) {
    const t = scry.primaryType(e.card);
    if (t === "Land") continue;
    const col = columns[Math.min(COLUMNS - 1, Math.floor(e.card.cmc ?? 0))];
    col.set(t, [...(col.get(t) ?? []), e]);
  }
  for (const col of columns) for (const es of col.values()) es.sort((a, z) => z.quantity - a.quantity || a.name.localeCompare(z.name));
  const sums = columns.map((col) => [...col.values()].reduce((n, es) => n + total(es), 0));
  const max = Math.max(1, ...sums);
  const present = TYPES.filter((t) => columns.some((col) => col.has(t)));

  const tip = (i: number, type: string) => {
    const col = columns[i];
    const es = col.get(type)!;
    const others = TYPES.filter((t) => t !== type && col.has(t));
    const more = es.length - EXAMPLES;
    return (
      <div className={`curve-tip${i < 2 ? " start" : i >= COLUMNS - 2 ? " end" : ""}`} role="tooltip">
        <strong className="curve-tip-head">
          <span className="type-dot" style={swatch(type)} />
          {type} <span className="muted">· mana value {label(i)} · {total(es)}</span>
        </strong>
        <div className="curve-tip-art">
          {es.slice(0, PICTURES).map((e) => {
            const img = scry.imageUrl(e.card, "normal");
            return img && <CardImg key={e.name} src={img} name={e.name} alt="" />;
          })}
        </div>
        <ul className="curve-tip-cards">
          {es.slice(0, EXAMPLES).map((e) => <li key={e.name}>{e.quantity > 1 ? `${e.name} ×${e.quantity}` : e.name}</li>)}
          {more > 0 && <li className="muted">+{more} more</li>}
        </ul>
        {others.length > 0 && (
          <p className="curve-tip-others muted">
            Also at {label(i)}:{" "}
            {others.map((t) => (
              <span key={t}><span className="type-dot" style={swatch(t)} />{total(col.get(t)!)} {t.toLowerCase()}</span>
            ))}
          </p>
        )}
      </div>
    );
  };

  return (
    <figure className="curve-chart">
      <figcaption>Mana curve <span className="muted small">main deck, nonland · hover a color for its cards, click a bar for more</span></figcaption>
      <div className="curve">
        {columns.map((col, i) => {
          const types = TYPES.filter((t) => col.has(t));
          const here = open?.mv === i ? open.type : null;
          return (
            <div
              key={i}
              className={`bar-col${here ? " open" : ""}${picked === i ? " picked" : ""}${sums[i] ? "" : " empty"}`}
              onClick={() => sums[i] && pick(i)}
              title={sums[i] ? (picked === i ? "Click to close" : `Click for the cards at mana value ${label(i)} and the chance to cast them on curve`) : undefined}
            >
              <span className="bar-n">{sums[i] || ""}</span>
              <div className="bar" style={{ height: `${(sums[i] / max) * 100}%` }}>
                {types.map((t) => {
                  const n = total(col.get(t)!);
                  return (
                    <div
                      key={t}
                      className={here === t ? "bar-seg open" : "bar-seg"}
                      style={{ ...swatch(t), flexGrow: n }}
                      tabIndex={0}
                      aria-label={`Mana value ${label(i)}: ${n} ${t.toLowerCase()}`}
                      onMouseEnter={() => setOpen({ mv: i, type: t })}
                      onMouseLeave={() => setOpen(null)}
                      onFocus={() => setOpen({ mv: i, type: t })}
                      onBlur={() => setOpen(null)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick(i))}
                    />
                  );
                })}
              </div>
              <span className="bar-label">{label(i)}</span>
              {here && tip(i, here)}
            </div>
          );
        })}
      </div>
      {present.length > 0 && (
        <ul className="curve-legend">
          {present.map((t) => <li key={t}><span className="type-dot" style={swatch(t)} />{t}</li>)}
        </ul>
      )}
      {picked !== null && sums[picked] > 0 && <CurveDetail mv={picked} column={columns[picked]} cards={cards} onClose={() => setPicked(null)} />}
    </figure>
  );
}

/** A card's colors; for a double-faced card its front face's (from its cost and color indicator). */
function frontColors(c: scry.ScryCard): string[] {
  const face = c.card_faces?.[0];
  if (!face || c.layout === "split") return c.colors ?? [];
  const found = new Set([...(face.mana_cost ?? "").matchAll(/\{([^}]*)\}/g)].flatMap((m) => m[1].match(/[WUBRG]/g) ?? []));
  for (const x of face.color_indicator ?? []) found.add(x);
  return ["W", "U", "B", "R", "G"].filter((x) => found.has(x));
}

/**
 * One mana value: the chance of having that many lands by that turn, the type and color breakdown,
 * and its cards by type.
 */
function CurveDetail({ mv, column, cards, onClose }: { mv: number; column: Map<string, Entry[]>; cards: Entry[]; onClose: () => void }) {
  const preview = useCardPreview();
  const size = total(cards);
  const isLand = (c: scry.ScryCard) => scry.primaryType(c) === "Land";
  const lands = total(cards.filter((e) => isLand(e.card)));
  const backs = total(cards.filter((e) => !isLand(e.card) && playableLandBack(e.card)));
  const landCount = lands + backs;
  const turn = Math.max(1, mv);
  const play = chanceOnCurve(size, landCount, mv, true);
  const draw = chanceOnCurve(size, landCount, mv, false);
  const types = TYPES.filter((t) => column.has(t));
  const here = types.flatMap((t) => column.get(t)!);
  const n = total(here);
  // Colors of the cards here: each card once per color it is, colorless as its own.
  const colors = new Map<string, number>();
  for (const e of here) {
    const cs = frontColors(e.card);
    for (const c of cs.length ? cs : ["C"]) colors.set(c, (colors.get(c) ?? 0) + e.quantity);
  }
  const colorList = ["W", "U", "B", "R", "G", "C"].filter((c) => colors.has(c));
  const colorTotal = colorList.reduce((a, c) => a + colors.get(c)!, 0);

  return (
    <section className="curve-detail" aria-label={`Mana value ${label(mv)}`}>
      <header>
        <h3>Mana value {label(mv)} <span className="muted">· {n} card{n === 1 ? "" : "s"}</span></h3>
        <button className="btn ghost small" onClick={onClose} aria-label="Close">✕</button>
      </header>
      {mv > 0 ? (
        <p className="curve-odds">
          <strong>{pct(play)}</strong> chance to have {mv} land{mv === 1 ? "" : "s"} by turn {turn} on the play
          <span className="muted"> · </span>
          <strong>{pct(draw)}</strong> on the draw
          <span className="muted small" title="Mana rocks, dorks and ramp spells aren't counted">
            {" "}({landCount} land{landCount === 1 ? "" : "s"}{backs ? `, ${backs} of them double-faced` : ""} in {size} cards{mv === COLUMNS - 1 ? `; ${COLUMNS - 1}+ counted as ${COLUMNS - 1}` : ""})
          </span>
        </p>
      ) : (
        <p className="curve-odds muted">Free to cast: no lands needed.</p>
      )}
      <div className="curve-breakdowns">
        <div>
          <span className="muted small">Types</span>
          <div className="split-bar">
            {types.map((t) => {
              const k = total(column.get(t)!);
              return (
                <span key={t} style={{ flexGrow: k, ...swatch(t) }} title={`${k} ${t.toLowerCase()}`}>
                  <TypeIcon type={t} /> {k}
                </span>
              );
            })}
          </div>
        </div>
        <div>
          <span className="muted small">Colors</span>
          <div className="split-bar colors">
            {colorList.map((c) => (
              <span key={c} className={`color-${c}`} style={{ flexGrow: colors.get(c)! / colorTotal }} title={`${colors.get(c)} ${COLOR_NAMES[c].toLowerCase()}`}>
                <ManaCost cost={`{${c}}`} /> {colors.get(c)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="curve-detail-cards">
        {types.map((t) => {
          const es = [...column.get(t)!].sort((a, z) => a.name.localeCompare(z.name));
          return (
            <div key={t} className="curve-detail-group">
              <h4><TypeIcon type={t} className={`t-${t.toLowerCase()}`} /> {t === "Sorcery" ? "Sorceries" : `${t}s`} <span className="muted">{total(es)}</span></h4>
              <ul>
                {es.map((e) => (
                  <li key={e.name} {...preview.handlers(e.card)}>
                    <span className="muted qty-n">{e.quantity}</span> {e.name}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {preview.element}
    </section>
  );
}
