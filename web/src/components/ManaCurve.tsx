import { useState } from "react";
import * as scry from "../scryfall";
import { TYPE_ORDER } from "../pages/boards";

type Entry = { name: string; quantity: number; card: scry.ScryCard };

/** Types in the chart, bottom of a bar first. Lands have no place on a mana curve. */
const TYPES = TYPE_ORDER.filter((t) => t !== "Land");
const COLUMNS = 8; // 0–6, then 7+
const EXAMPLES = 8;
const PICTURES = 4;

const label = (i: number) => (i === COLUMNS - 1 ? `${i}+` : String(i));
const swatch = (t: string) => ({ background: `var(--type-${t.toLowerCase()})` });
const total = (es: Entry[]) => es.reduce((n, e) => n + e.quantity, 0);

/**
 * The main deck's nonland cards by mana value, each bar split by card type. Hovering (or focusing)
 * one type's part of a bar shows that type's cards at that mana value, and how many of each other
 * type share it.
 */
export function ManaCurve({ cards }: { cards: Entry[] }) {
  const [open, setOpen] = useState<{ mv: number; type: string } | null>(null);
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
            return img && <img key={e.name} src={img} alt="" />;
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
      <figcaption>Mana curve <span className="muted small">main deck, nonland · hover a color for its cards</span></figcaption>
      <div className="curve">
        {columns.map((col, i) => {
          const types = TYPES.filter((t) => col.has(t));
          const here = open?.mv === i ? open.type : null;
          return (
            <div key={i} className={here ? "bar-col open" : "bar-col"}>
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
    </figure>
  );
}
