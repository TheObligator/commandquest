// Forge's questions, each in a window over the table (docs: every decision but the routine flow —
// priority, play or draw, mulligans, attackers and blockers, yes/no — gets one). They share a frame:
// the question, the card asking it, OK, and "Look at the table", which hides the window until the
// Decision panel's button brings it back. Esc hides too; it never answers.
//
// - ChooseWindow: pick options (modes, "choose an ability") as rows, or short ones (a color, a
//   player, a creature type) as tiles; a filter for long lists (name a card). Also Forge's reveals.
// - TextWindow: type a number (with − and +) or some text.
// - OrderWindow: put things in order (triggers, cards on top of your library), dragging or ▲ ▼.
// - ArrangeWindow: each card to the top or the bottom of your library.
// - DistributeWindow: divide an amount (damage, counters) among cards and players.
import { useEffect, useMemo, useRef, useState } from "react";
import { cardImage, CardFace, previewFor, usePreview } from "./cards";
import { useHotkeys } from "./useHotkeys";
import type { AskOption, LiveAsk } from "./useLiveGame";
import type { CardView } from "./view";

export interface WindowProps {
  ask: LiveAsk;
  /** Answer with option indexes (or numbers, for distribute; text for a typed answer). */
  onAnswer: (choice: number[] | null, text?: string) => void;
  onHide: () => void;
  viewer: string;
  nameOf: (id: string) => string;
  colorOf: (id: string) => string;
}

/** The window for this question, or null when it isn't asked in one. */
export function DecisionWindow(props: WindowProps) {
  switch (props.ask.kind) {
    case "choose":
    case "info":
      return <ChooseWindow {...props} />;
    case "text":
      return <TextWindow {...props} />;
    case "order":
      return <OrderWindow {...props} />;
    case "arrange":
      return <ArrangeWindow {...props} />;
    case "distribute":
      return <DistributeWindow {...props} />;
    default:
      return null;
  }
}

/** Is this question asked in a DecisionWindow? (Yes/no stays in the Decision panel.) */
export function askInWindow(ask: LiveAsk | null | undefined): boolean {
  if (!ask || ask.yesNo || ask.mana) return false;
  return ["choose", "info", "text", "order", "arrange", "distribute"].includes(ask.kind);
}

function Frame(props: {
  ask: LiveAsk;
  sub?: React.ReactNode;
  children: React.ReactNode;
  ok: { label: string; enabled: boolean; onClick: () => void };
  extra?: React.ReactNode;
  onHide: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const setPreview = usePreview();
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);
  useHotkeys({ ok: () => (props.ok.enabled ? props.ok.onClick() : false) });
  const { ask } = props;
  const [first, ...more] = (ask.title || ask.message || "Choose").split("\n");
  const body = ask.title ? ask.message : more.join("\n");
  const src = ask.card && !ask.card.hidden ? ask.card : undefined;
  const srcImg = src?.name ? cardImage(src.name, "small") : undefined;
  return (
    <dialog ref={ref} className={`decision-window${props.wide ? " wide" : ""}`} aria-label={first} onCancel={(e) => (e.preventDefault(), props.onHide())}>
      <button className="dialog-close" aria-label="Hide (look at the table)" title="Hide: look at the table" onClick={props.onHide}>×</button>
      <div className="dw-head">
        {src && srcImg && (
          <img className="dw-src" src={srcImg} alt="" onMouseEnter={() => setPreview({ card: src })} onMouseLeave={() => setPreview(null)} />
        )}
        <div>
          <h3>{first}</h3>
          {body.trim() && body.trim() !== first && <p className="dw-sub">{body}</p>}
          {props.sub && <p className="dw-sub">{props.sub}</p>}
        </div>
      </div>
      <div className="dw-body">{props.children}</div>
      <div className="dw-btns">
        <button className="btn small" disabled={!props.ok.enabled} onClick={props.ok.onClick}>{props.ok.label}</button>
        {props.extra}
        <button className="btn small ghost" onClick={props.onHide}>Look at the table</button>
      </div>
    </dialog>
  );
}

/** An option's picture: its card's art, a player's colored initials, or a mana symbol's color. */
function OptionArt({ o, colorOf }: { o: AskOption; colorOf: (id: string) => string }) {
  const img = o.card && !o.card.hidden ? cardImage(o.card.name, "small") : undefined;
  if (img) return <img className="dw-art" src={img} alt="" />;
  if (o.playerId) return <span className="dw-ava" style={{ background: colorOf(o.playerId) }}>{initials(o.label)}</span>;
  if (o.mana) return <span className={`dw-pip mana-${o.mana}`} aria-hidden />;
  return null;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const howMany = (min: number, max: number) => (min === max ? `${min}` : min ? `${min} to ${max}` : `up to ${max}`);

/** Options as tiles when they're all short words, players or colors; rows otherwise (modes, abilities). */
function tiled(options: AskOption[]) {
  if (options.length > 24 || options.some((o) => o.card)) return false;
  return options.every((o) => o.playerId || o.mana || o.label.length <= 18);
}

function ChooseWindow({ ask, onAnswer, onHide, viewer, nameOf, colorOf }: WindowProps) {
  const options = ask.options ?? [];
  const info = ask.kind === "info";
  const [picked, setPicked] = useState<number[]>(() => (info ? [] : (ask.selected ?? []).filter((i) => i >= 0 && i < options.length).slice(0, ask.max)));
  const [query, setQuery] = useState("");
  const setPreview = usePreview();
  const tiles = tiled(options);
  const cardsOnly = info && options.length > 0 && options.every((o) => o.card);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.map((o, i) => ({ o, i })).filter(({ o }) => !q || o.label.toLowerCase().includes(q));
  }, [options, query]);
  const toggle = (i: number) =>
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : ask.max === 1 ? [i] : p.length < ask.max ? [...p, i] : p));
  const enabled = info || (picked.length >= ask.min && picked.length <= ask.max);
  const answer = () => onAnswer(info ? [] : picked);
  const okLabel = info ? "OK" : picked.length === 0 && ask.min === 0 ? "Choose none" : "OK";
  const hover = (o: AskOption) => ({
    onMouseEnter: () => o.card && setPreview(previewFor(o.card, viewer, nameOf)),
    onMouseLeave: () => setPreview(null),
  });
  return (
    <Frame
      ask={ask}
      wide={cardsOnly || options.length > 8}
      sub={info ? undefined : ask.max > 1 ? `Choose ${howMany(ask.min, ask.max)} · ${picked.length} chosen` : ask.min === 0 ? "You may choose none." : undefined}
      ok={{ label: okLabel, enabled, onClick: answer }}
      onHide={onHide}
    >
      {options.length > 12 && !cardsOnly && (
        <input className="dw-filter" type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type to find one…" aria-label="Filter the choices" />
      )}
      {cardsOnly ? (
        <div className="dw-cards">
          {options.map((o, i) => (
            <figure key={i} {...hover(o)}>
              <div className="dw-card"><CardFace card={o.card as CardView} /></div>
              <figcaption>{o.label}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <ul className={tiles ? "dw-tiles" : "dw-rows"} role="listbox" aria-multiselectable={ask.max > 1}>
          {shown.map(({ o, i }) => (
            <li key={i}>
              <button
                type="button"
                role="option"
                aria-selected={picked.includes(i)}
                className={`dw-opt${picked.includes(i) ? " on" : ""}`}
                disabled={info}
                onClick={() => toggle(i)}
                // One choice: a double-click answers it.
                onDoubleClick={() => ask.max === 1 && ask.min <= 1 && onAnswer([i])}
                {...hover(o)}
              >
                <OptionArt o={o} colorOf={colorOf} />
                <span>{o.label}</span>
              </button>
            </li>
          ))}
          {!shown.length && <li className="dw-sub">Nothing matches.</li>}
        </ul>
      )}
    </Frame>
  );
}

function TextWindow({ ask, onAnswer, onHide }: WindowProps) {
  const [text, setText] = useState(ask.initial ?? (ask.numeric ? "0" : ""));
  const n = Number(text);
  const step = (by: number) => setText(String(Math.max(0, (Number.isFinite(n) ? n : 0) + by)));
  const enabled = !ask.numeric || (text.trim() !== "" && Number.isFinite(n));
  return (
    <Frame ask={ask} ok={{ label: "OK", enabled, onClick: () => onAnswer(null, text) }} onHide={onHide}>
      <form
        className="dw-text"
        onSubmit={(e) => {
          e.preventDefault();
          if (enabled) onAnswer(null, text);
        }}
      >
        {ask.numeric && <button type="button" className="dw-step" aria-label="Less" onClick={() => step(-1)}>−</button>}
        <input autoFocus inputMode={ask.numeric ? "numeric" : undefined} className={ask.numeric ? "num" : undefined} value={text} onChange={(e) => setText(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
        {ask.numeric && <button type="button" className="dw-step" aria-label="More" onClick={() => step(1)}>+</button>}
      </form>
    </Frame>
  );
}

/** A row for an option you move about: its art, its name and (hovered) its card. */
function OptionRow({ o, colorOf, viewer, nameOf, children, ...rest }: { o: AskOption; colorOf: (id: string) => string; viewer: string; nameOf: (id: string) => string; children?: React.ReactNode } & React.LiHTMLAttributes<HTMLLIElement>) {
  const setPreview = usePreview();
  return (
    <li {...rest} onMouseEnter={() => o.card && setPreview(previewFor(o.card, viewer, nameOf))} onMouseLeave={() => setPreview(null)}>
      <OptionArt o={o} colorOf={colorOf} />
      <span className="dw-label">{o.label}</span>
      <span className="dw-ctrl">{children}</span>
    </li>
  );
}

function OrderWindow({ ask, onAnswer, onHide, colorOf, viewer, nameOf }: WindowProps) {
  const all = ask.options ?? [];
  const [order, setOrder] = useState<number[]>(() => all.map((_, i) => i));
  const [out, setOut] = useState<number[]>(() => (ask.max < all.length ? all.map((_, i) => i).slice(ask.max) : []));
  const [dragging, setDragging] = useState<number | null>(null);
  const kept = order.filter((i) => !out.includes(i));
  const enabled = kept.length >= ask.min && kept.length <= ask.max;
  const canLeaveOut = ask.min < all.length;
  const moveTo = (i: number, to: number) =>
    setOrder((o) => {
      const n = o.filter((x) => x !== i);
      n.splice(Math.max(0, Math.min(n.length, to)), 0, i);
      return n;
    });
  return (
    <Frame
      ask={ask}
      sub={`${ask.top ? `First: ${ask.top}. ` : ""}Drag to reorder, or use ▲ ▼${canLeaveOut ? `; keep ${howMany(ask.min, ask.max)}` : ""}.`}
      ok={{ label: "OK", enabled, onClick: () => onAnswer(kept) }}
      onHide={onHide}
    >
      <ol className="dw-list">
        {order.map((i, pos) => (
          <OptionRow
            key={i}
            o={all[i]}
            colorOf={colorOf}
            viewer={viewer}
            nameOf={nameOf}
            className={[out.includes(i) && "out", dragging === i && "dragging"].filter(Boolean).join(" ") || undefined}
            draggable
            onDragStart={(e) => {
              setDragging(i);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(i));
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => {
              if (dragging === null || dragging === i) return;
              e.preventDefault();
              moveTo(dragging, pos);
            }}
          >
            <span className="dw-grip" aria-hidden>⋮⋮</span>
            <button type="button" aria-label="Move up" disabled={pos === 0} onClick={() => moveTo(i, pos - 1)}>▲</button>
            <button type="button" aria-label="Move down" disabled={pos === order.length - 1} onClick={() => moveTo(i, pos + 1)}>▼</button>
            {canLeaveOut && (
              <button type="button" aria-pressed={!out.includes(i)} title={out.includes(i) ? "Keep it" : "Leave it out"} onClick={() => setOut((o) => (o.includes(i) ? o.filter((x) => x !== i) : [...o, i]))}>
                {out.includes(i) ? "+" : "−"}
              </button>
            )}
          </OptionRow>
        ))}
      </ol>
    </Frame>
  );
}

function ArrangeWindow({ ask, onAnswer, onHide, colorOf, viewer, nameOf }: WindowProps) {
  const all = ask.options ?? [];
  const [top, setTop] = useState<number[]>(() => (ask.toTop !== false ? all.map((_, i) => i) : []));
  const [bottom, setBottom] = useState<number[]>(() => (ask.toTop !== false ? [] : all.map((_, i) => i)));
  const move = (list: number[], set: (v: number[]) => void, pos: number, by: number) => {
    const to = pos + by;
    if (to < 0 || to >= list.length) return;
    const n = [...list];
    [n[pos], n[to]] = [n[to], n[pos]];
    set(n);
  };
  const flip = (i: number, toBottom: boolean) => {
    if (toBottom) {
      setTop((t) => t.filter((x) => x !== i));
      setBottom((b) => [...b, i]);
    } else {
      setBottom((b) => b.filter((x) => x !== i));
      setTop((t) => [...t, i]);
    }
  };
  const rows = (list: number[], set: (v: number[]) => void, onBottom: boolean) =>
    list.length ? (
      list.map((i, pos) => (
        <OptionRow key={i} o={all[i]} colorOf={colorOf} viewer={viewer} nameOf={nameOf}>
          {list.length > 1 && (
            <>
              <button type="button" aria-label="Move up" disabled={pos === 0} onClick={() => move(list, set, pos, -1)}>▲</button>
              <button type="button" aria-label="Move down" disabled={pos === list.length - 1} onClick={() => move(list, set, pos, 1)}>▼</button>
            </>
          )}
          {(onBottom ? ask.toTop !== false : ask.toBottom !== false) && (
            <button type="button" className="dw-word" onClick={() => flip(i, !onBottom)}>{onBottom ? "Top" : "Bottom"}</button>
          )}
        </OptionRow>
      ))
    ) : (
      <li className="dw-sub">None</li>
    );
  return (
    <Frame ask={ask} ok={{ label: "OK", enabled: true, onClick: () => onAnswer([...top, -1, ...bottom]) }} onHide={onHide}>
      <p className="dw-sub">Top of your library (first = top)</p>
      <ol className="dw-list">{rows(top, setTop, false)}</ol>
      {(ask.toBottom !== false || bottom.length > 0) && (
        <>
          <p className="dw-sub">Bottom of your library (last = bottom)</p>
          <ol className="dw-list">{rows(bottom, setBottom, true)}</ol>
        </>
      )}
    </Frame>
  );
}

function DistributeWindow({ ask, onAnswer, onHide, colorOf, viewer, nameOf }: WindowProps) {
  const all = ask.options ?? [];
  const total = ask.amount ?? 0;
  const low = ask.atLeastOne ? 1 : 0;
  const [n, setN] = useState<number[]>(() => {
    const start = all.map(() => low);
    if (start.length) start[0] += Math.max(0, total - low * all.length);
    return start;
  });
  const sum = n.reduce((a, b) => a + b, 0);
  const enabled = sum === total && n.every((x) => x >= low);
  const set = (i: number, by: number) =>
    setN((v) => v.map((x, j) => (j === i ? Math.max(low, Math.min(all[i].max ?? total, x + by)) : x)));
  const left = total - sum;
  return (
    <Frame
      ask={ask}
      sub={`${left === 0 ? "All assigned" : left > 0 ? `${left} left to assign` : `${-left} too many`}${ask.atLeastOne ? " · at least 1 each" : ""}`}
      ok={{ label: "OK", enabled, onClick: () => onAnswer(n) }}
      onHide={onHide}
    >
      <ul className="dw-list">
        {all.map((o, i) => (
          <OptionRow key={i} o={o} colorOf={colorOf} viewer={viewer} nameOf={nameOf}>
            <button type="button" aria-label="Less" disabled={n[i] <= low} onClick={() => set(i, -1)}>−</button>
            <b className="dw-n">{n[i]}</b>
            <button type="button" aria-label="More" disabled={sum >= total || (o.max !== undefined && n[i] >= o.max)} onClick={() => set(i, 1)}>+</button>
          </OptionRow>
        ))}
      </ul>
    </Frame>
  );
}
