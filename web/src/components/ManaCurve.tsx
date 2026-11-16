import { useState } from "react";
import * as scry from "../scryfall";
import { TYPE_ORDER } from "../pages/boards";

type Entry = { name: string; quantity: number; card: scry.ScryCard };

/** Types in the chart, bottom of a bar first. Lands have no place on a mana curve. */
const TYPES = TYPE_ORDER.filter((t) => t !== "Land");
const COLUMNS = 8; // 0–6, then 7+
const EXAMPLES = 3;

const label = (i: number) => (i === COLUMNS - 1 ? `${i}+` : String(i));
const swatch = (t: string) => ({ background: `var(--type-${t.toLowerCase()})` });
const total = (es: Entry[]) => es.reduce((n, e) => n + e.quantity, 0);

/**
 * The main deck's nonland cards by mana value, each bar split by card type. Hovering (or focusing)
 * a bar shows how many of each type it has, with a few of the cards.
 */
export function ManaCurve({ cards }: { cards: Entry[] }) {
  const [open, setOpen] = useState<number | null>(null);
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

  return (
    <figure className="curve-chart">
      <figcaption>Mana curve <span className="muted small">main deck, nonland · hover a bar for its cards</span></figcaption>
      <div className="curve">
        {columns.map((col, i) => {
          const types = TYPES.filter((t) => col.has(t));
          const summary = types.map((t) => `${total(col.get(t)!)} ${t.toLowerCase()}`).join(", ");
          return (
            <div
              key={i}
              className={open === i ? "bar-col open" : "bar-col"}
              tabIndex={sums[i] ? 0 : -1}
              aria-label={`Mana value ${label(i)}: ${sums[i]} card${sums[i] === 1 ? "" : "s"}${summary ? ` (${summary})` : ""}`}
              onMouseEnter={() => setOpen(i)}
              onMouseLeave={() => setOpen(null)}
              onFocus={() => setOpen(i)}
              onBlur={() => setOpen(null)}
            >
              <span className="bar-n">{sums[i] || ""}</span>
              <div className="bar" style={{ height: `${(sums[i] / max) * 100}%` }}>
                {types.map((t) => <div key={t} className="bar-seg" style={{ ...swatch(t), flexGrow: total(col.get(t)!) }} />)}
              </div>
              <span className="bar-label">{label(i)}</span>
              {open === i && sums[i] > 0 && (
                <div className={`curve-tip${i < 2 ? " start" : i >= COLUMNS - 2 ? " end" : ""}`} role="tooltip">
                  <strong>Mana value {label(i)}<span className="muted"> · {sums[i]}</span></strong>
                  <div className="curve-tip-art">
                    {types.slice(0, 4).map((t) => {
                      const top = col.get(t)![0].card;
                      const img = scry.imageUrl(top, "normal");
                      return img && <img key={t} src={img} alt="" />;
                    })}
                  </div>
                  <ul>
                    {types.map((t) => {
                      const es = col.get(t)!;
                      const more = es.length - EXAMPLES;
                      return (
                        <li key={t}>
                          <span className="type-dot" style={swatch(t)} />
                          <span className="curve-tip-type">{t} <b>{total(es)}</b></span>
                          <span className="muted">
                            {es.slice(0, EXAMPLES).map((e) => (e.quantity > 1 ? `${e.name} ×${e.quantity}` : e.name)).join(", ")}
                            {more > 0 && `, +${more} more`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
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
