// The stack as a floating window over the table: one tile per spell or ability, top first, with
// its art, kind, rules text and targets. Drag it by its title bar and resize it from the corner;
// both are remembered in this browser. Click a tile, its "⋯" or right-click it for the full text
// and (live games) its auto-yield settings. Lines run from each item to what it targets.
// While you're choosing targets (a counterspell), spells you can target glow, and clicking one
// targets it; "⋯" and right-click still open it.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Area, type Box, useFloatingBox } from "./floatingBox";
import type { MenuSection } from "../components/CardMenu";
import { CardImg } from "../components/CardImg";
import { cached, imageUrl } from "../scryfall";
import { tokenImage, usePreview } from "./cards";
import { AbilityMarks } from "./AbilityMenu";
import { stackText } from "./stackText";
import { awayLabel, findCardEl, findPlayerEl, type Spot, spotOf } from "./locate";
import type { GameView, StackItemView } from "./view";

const KEY = "cq.stack.box.v2"; // v2: starts in the middle of the table (was the top left)
/** First time: in the middle of the table. */
const defaultBox = (area: Area): Box => {
  const w = 250;
  const h = Math.min(400, Math.max(140, area.h - 16));
  return { x: Math.max(8, Math.round((area.w - w) / 2)), y: Math.max(8, Math.round((area.h - h) / 2)), w, h };
};

function art(s: StackItemView): string | undefined {
  if (!s.card || s.card.hidden) return undefined;
  if (s.card.token) return tokenImage(s.card);
  const sc = s.card.name ? cached({ name: s.card.name, quantity: 1, board: "main" }) : undefined;
  return sc && imageUrl(sc, "art_crop");
}

/** A spell (not an ability) shows its whole card: the image for that, or undefined to show the art and text. */
function fullCard(s: StackItemView, size: "normal" | "large"): string | undefined {
  if (s.kind !== "Spell" || !s.card || s.card.hidden || s.card.token) return undefined;
  const sc = s.card.name ? cached({ name: s.card.name, quantity: 1, board: "main" }) : undefined;
  return sc && imageUrl(sc, size);
}

/** Stack positions are numbered from the bottom: 1 resolves last. */
const numberOf = (view: GameView, s: StackItemView) => view.stack.indexOf(s) + 1;

export function StackWindow(props: {
  view: GameView;
  nameOf: (id: string) => string;
  colorOf: (id: string) => string;
  /** Live games: an item's auto-yield settings. */
  itemMenu?: (s: StackItemView) => MenuSection[];
  /** Cards the current prompt lets you pick: a spell whose card is one is a target you can click. */
  selectable?: Set<number>;
  /** Cards chosen so far for the current prompt. */
  chosen?: Set<number>;
  /** Picks a spell's card (as a click on it would). */
  onPick?: (cardId: number) => void;
}) {
  const { view, nameOf, colorOf, selectable, chosen, onPick } = props;
  const pickable = (s: StackItemView) => s.cardId !== undefined && !!onPick && !!selectable?.has(s.cardId);
  const { box, ref, startDrag, onResizeEnd } = useFloatingBox(KEY, defaultBox);
  const [open, setOpen] = useState<{ id: number; x: number; y: number } | null>(null);
  const setPreview = usePreview();

  const openItem = (e: React.MouseEvent, s: StackItemView) => {
    e.preventDefault();
    e.stopPropagation();
    const tile = (e.currentTarget as HTMLElement).closest(".stk-item") as HTMLElement;
    const r = tile.getBoundingClientRect();
    setOpen((o) => (o?.id === s.id && e.type === "click" ? null : { id: s.id, x: r.right + 8, y: r.top }));
  };

  const items = [...view.stack].reverse(); // top first
  const openItemView = open ? view.stack.find((s) => s.id === open.id) : undefined;
  useEffect(() => {
    if (open && !openItemView) setOpen(null); // it resolved
  }, [open, openItemView]);

  if (!items.length) return null;
  return (
    <>
      <div
        ref={ref}
        className="stack-window"
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        onPointerUp={onResizeEnd}
        role="region"
        aria-label="The stack"
      >
        <header className="stk-head" onPointerDown={startDrag} title="Drag to move. Resize from the bottom-right corner.">
          <span className="stk-grip" aria-hidden>⠿</span>
          <h3>The Stack</h3>
          <span className="stk-count">{items.length}</span>
        </header>
        <ol className="stk-list">
          {items.map((s) => {
            const src = art(s);
            const whole = fullCard(s, "normal");
            const n = numberOf(view, s);
            const targets = s.targets ?? [];
            const pick = pickable(s);
            const picked = s.cardId !== undefined && !!chosen?.has(s.cardId);
            return (
              <li
                key={s.id}
                className={`stk-item${open?.id === s.id ? " open" : ""}${pick ? " selectable" : ""}${picked ? " chosen" : ""}`}
                data-stack-id={s.id}
                style={{ "--seat": colorOf(s.controller) } as React.CSSProperties}
                title={pick ? `Target ${s.name}` : undefined}
                onClick={(e) => {
                  if (!pick) return openItem(e, s);
                  e.stopPropagation();
                  setOpen(null);
                  onPick!(s.cardId!);
                }}
                onContextMenu={(e) => openItem(e, s)}
                onMouseEnter={() => s.card && setPreview({ card: s.card })}
                onMouseLeave={() => setPreview(null)}
              >
                <span className="stk-num" aria-label={`Stack position ${n}`}>{n}</span>
                <div className="stk-name">{s.name}</div>
                {whole ? (
                  <CardImg className="stk-card" src={whole} name={s.name} alt={s.name} draggable={false} />
                ) : src ? (
                  <CardImg tiny className="stk-art" src={src} name={s.name} alt="" draggable={false} />
                ) : (
                  <div className="stk-art none" />
                )}
                <div className="stk-kind">
                  {s.kind}
                  <span> · {s.controller === view.viewer ? "you" : nameOf(s.controller)}</span>
                  <AbilityMarks setting={s} />
                </div>
                {s.text && !whole && <p className="stk-text">{stackText(s.text, s.card?.name ?? s.name).text}</p>}
                <footer className="stk-foot">
                  <span className="stk-targets">{targets.length ? `→ ${targets.map((t) => t.label).join(", ")}` : ""}</span>
                  <button className="stk-more" aria-label={`More about ${s.name}`} onClick={(e) => openItem(e, s)}>
                    ⋯
                  </button>
                </footer>
              </li>
            );
          })}
        </ol>
      </div>
      {open && openItemView && (
        <StackDetail
          item={openItemView}
          number={numberOf(view, openItemView)}
          x={open.x}
          y={open.y}
          src={art(openItemView)}
          menu={props.itemMenu?.(openItemView) ?? []}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

/** An item opened from the stack: the whole ability, targets included, with its settings menu under it. */
function StackDetail(props: { item: StackItemView; number: number; x: number; y: number; src?: string; menu: MenuSection[]; onClose: () => void }) {
  const { item, menu, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(props.x, innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(props.y, innerHeight - r.height - 8)),
    });
  }, [props.x, props.y, item]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!ref.current?.contains(t) && !t.closest?.(".stk-item")) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);

  const sections = menu.filter((s) => s.items.length);
  const text = stackText(item.text ?? "", item.card?.name ?? item.name);
  const whole = fullCard(item, "large");
  return (
    <div ref={ref} className="stk-detail-wrap" style={pos} onContextMenu={(e) => (e.preventDefault(), e.stopPropagation())}>
      <article className="stk-detail" style={{ "--seat": "var(--accent)" } as React.CSSProperties}>
        <header>
          <h4>
            <span className="stk-num inline">{props.number}</span> {item.name}
          </h4>
          <button className="dialog-close" aria-label="Close" onClick={onClose}>×</button>
        </header>
        {whole ? (
          <CardImg className="stk-card" src={whole} name={item.name} alt={item.name} draggable={false} />
        ) : (
          props.src && <CardImg tiny className="stk-art" src={props.src} name={item.name} alt="" draggable={false} />
        )}
        <div className="stk-kind">{item.kind}</div>
        <p className="stk-full">{text.text || item.name}</p>
        {text.info.length > 0 && <p className="stk-full-info">{text.info.join(" · ")}</p>}
        {item.targets?.length ? <p className="stk-full-targets">Targets: {item.targets.map((t) => t.label).join(", ")}</p> : null}
        {/* Its settings go under the text, so they never cover the name or the art. */}
        {sections.length > 0 && (
          <div className="card-menu stk-menu" role="menu" aria-label={`${item.name} settings`}>
            {sections.map((s, i) => (
              <div key={i} className="card-menu-section">
                {s.title && <div className="card-menu-title">{s.title}</div>}
                {s.items.map((it) => it.panel ? <div key={it.label}>{it.panel}</div> : (
                  <button key={it.label} role="menuitem" disabled={it.disabled} onClick={() => it.onSelect()}>
                    {it.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}

// ---- Lines to what each item targets -----------------------------------------------------------

interface Line {
  key: string;
  d: string;
  color: string;
  dashed: boolean;
  n: number;
  end: Spot;
}

/** The name of the card with this id on the table, for an arrow's "elsewhere" label. */
const cardName = (v: GameView, id: number) => {
  for (const p of v.players) for (const zone of [p.battlefield, p.graveyard, p.exile, p.command]) {
    const c = zone?.find((x) => x.id === id);
    if (c) return c.hidden ? undefined : c.name;
  }
  return undefined;
};

/**
 * Curved lines from each stack tile to the cards and players it targets, numbered like the tile,
 * and a dashed one to the permanent an ability comes from. Positions follow the page every frame
 * while the stack has something on it (boards resize, the window gets dragged). With a board
 * enlarged, they go to the enlarged board; a target on another board gets a line to the edge,
 * toward it, labeled with where it is.
 */
export function StackArrows({ view, colorOf }: { view: GameView; colorOf: (id: string) => string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const viewRef = useRef(view);
  viewRef.current = view;
  const colorRef = useRef(colorOf);
  colorRef.current = colorOf;
  const active = view.stack.length > 0;

  useEffect(() => {
    if (!active) {
      setLines([]);
      return;
    }
    let raf = 0;
    let lastKey = "";
    const top = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + Math.min(14, r.height / 3) });
    const tick = () => {
      const v = viewRef.current;
      const next: Line[] = [];
      for (const s of v.stack) {
        const tile = document.querySelector<HTMLElement>(`[data-stack-id="${s.id}"]`);
        if (!tile) continue;
        const from = tile.getBoundingClientRect();
        const n = v.stack.indexOf(s) + 1;
        const color = colorRef.current(s.controller);
        const ends: { el: HTMLElement; dashed: boolean; key: string; name?: string }[] = [];
        for (const t of s.targets ?? []) {
          const el = t.cardId !== undefined ? findCardEl(t.cardId) : t.playerId !== undefined ? findPlayerEl(t.playerId) : null;
          if (el) ends.push({ el, dashed: false, key: `${t.cardId ?? "p" + t.playerId}`, name: t.cardId !== undefined ? cardName(v, t.cardId) : undefined });
        }
        // An ability's source permanent (spells' cards are on the stack itself).
        if (s.card && s.cardId === undefined && s.card.zone === "battlefield") {
          const el = findCardEl(s.card.id);
          if (el && !ends.some((e) => e.el === el)) ends.push({ el, dashed: true, key: `src${s.card.id}` });
        }
        for (const end of ends) {
          const b = spotOf(end.el, top, end.name);
          if (!b || (end.dashed && b.away) || overlaps(from, b.rect)) continue;
          const a = { x: from.right - 6, y: from.top + Math.min(40, from.height / 2) };
          if (b.x < from.left) a.x = from.left + 6; // target to the left of the window
          const mid = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - Math.max(40, Math.abs(b.x - a.x) * 0.25) };
          next.push({ key: `${s.id}-${end.key}`, d: `M${a.x},${a.y} Q${mid.x},${mid.y} ${b.x},${b.y}`, color, dashed: end.dashed, n, end: b });
        }
      }
      const key = next.map((l) => l.key + l.d + (l.end.away ?? "")).join("|");
      if (key !== lastKey) {
        lastKey = key;
        setLines(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  if (!lines.length) return null;
  return (
    <svg className="stack-arrows" aria-hidden>
      {lines.map((l) => (
        <g key={l.key} style={{ "--seat": l.color } as React.CSSProperties}>
          <path className="sa-glow" d={l.d} />
          <path className={`sa-line${l.dashed ? " dashed" : ""}`} d={l.d} />
          {!l.dashed && (
            <g transform={`translate(${l.end.x},${l.end.y})`}>
              <circle r="10" />
              <text dy="4">{l.n}</text>
            </g>
          )}
          {l.end.away && <AwayLabel spot={l.end} />}
        </g>
      ))}
    </svg>
  );
}

/** "Llanowar Elves · on Ann's board": where an arrow's target is when an enlarged board covers it. */
export function AwayLabel({ spot }: { spot: Spot }) {
  const b = awayLabel(spot);
  return (
    <g className="sa-away">
      <rect x={b.x} y={b.y} width={b.w} height="18" rx="9" />
      <text x={b.x + 8} y={b.y + 13}>{spot.away}</text>
    </g>
  );
}

export { findCardEl };

const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
