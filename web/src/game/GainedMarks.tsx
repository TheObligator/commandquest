// What a permanent gained in this game that isn't printed on it (equipment, anthems, "gains flying
// until end of turn"…), from the server's `gained`: keyword icons and a text overlay on the card,
// and a "Gained this game" list for the hover zoom and card details.
import { useState } from "react";
import { createPortal } from "react-dom";
import { Symbol } from "../components/ManaCost";
import { type Gained, keywordIcon } from "./gained";
import { topLayerHost } from "./TopLayer";

/** Keyword icons shown on a card before the rest become "+N". */
const MAX_ICONS = 5;

/** Text with {T}, {G} and so on as Scryfall's symbols. */
export function SymText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\{[^}]+\})/).filter(Boolean).map((part, i) =>
        /^\{[^}]+\}$/.test(part) ? <Symbol key={i} sym={part.slice(1, -1)} /> : part)}
    </>
  );
}

function KeywordTip({ g, at }: { g: Gained; at: DOMRect }) {
  const icon = keywordIcon(g.keyword, g.text);
  const below = at.top < 140;
  const left = Math.min(Math.max(at.left + at.width / 2, 140), innerWidth - 140);
  return createPortal(
    <div
      className="gk-tip"
      role="tooltip"
      style={{ left, top: below ? at.bottom + 8 : at.top - 8, transform: `translate(-50%, ${below ? "0" : "-100%"})` }}
    >
      <strong>{icon && <i className={icon} />}<SymText text={g.text} /></strong>
      {g.reminder && <p><SymText text={g.reminder} /></p>}
      <small>Gained{g.source ? ` from ${g.source}` : ""}. Not printed on the card.</small>
    </div>,
    topLayerHost(),
  );
}

/** On a permanent: gained keywords down its right edge, a gained ability's text over its text box. */
export function GainedMarks({ gained }: { gained?: Gained[] }) {
  const [tip, setTip] = useState<{ g: Gained; at: DOMRect } | null>(null);
  if (!gained?.length) return null;
  const keywords = gained.filter((g) => g.keyword);
  const abilities = gained.filter((g) => !g.keyword);
  const shown = keywords.slice(0, MAX_ICONS);
  const hover = (g: Gained) => ({
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => setTip({ g, at: e.currentTarget.getBoundingClientRect() }),
    onPointerLeave: () => setTip(null),
  });
  return (
    <>
      {keywords.length > 0 && (
        <span className="gk-list">
          {shown.map((g) => {
            const icon = keywordIcon(g.keyword, g.text);
            return icon ? (
              <span key={g.text} className="gk" aria-label={`${g.text} (gained)`} {...hover(g)}><i className={icon} /></span>
            ) : (
              <span key={g.text} className="gk text" aria-label={`${g.text} (gained)`} {...hover(g)}>
                <span className="gk-full">+{g.text}</span><span className="gk-short">+{g.text.slice(0, 2)}</span>
              </span>
            );
          })}
          {keywords.length > shown.length && <span className="gk-more">+{keywords.length - shown.length}</span>}
        </span>
      )}
      {abilities.length > 0 && (
        <span className="ga-text" aria-label={`Gained: ${abilities.map((a) => a.text).join(" ")}`}>
          <span className="ga-line"><b>+</b> <SymText text={abilities[0].text} /></span>
          {abilities.length > 1 && <span className="ga-more">+{abilities.length - 1} more</span>}
          <span className="ga-count">+{abilities.length}</span>
        </span>
      )}
      {tip && <KeywordTip g={tip.g} at={tip.at} />}
    </>
  );
}

/** Everything gained, one per line with where it came from: under the hover zoom and in card details. */
export function GainedList({ gained, reminders }: { gained?: Gained[]; reminders?: boolean }) {
  if (!gained?.length) return null;
  return (
    <section className="gained-box" aria-label="Gained this game">
      <header><b>Gained this game</b><span>not printed on the card</span></header>
      <ul>
        {gained.map((g) => {
          const icon = keywordIcon(g.keyword, g.text);
          return (
            <li key={g.text}>
              <span className="gl-text">
                {icon ? <i className={icon} /> : <span className="gl-plus">+</span>}
                <SymText text={g.text} />
                {reminders && g.reminder && <span className="gl-rem"><SymText text={g.reminder} /></span>}
              </span>
              {g.source && <span className="gl-src">from {g.source}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
