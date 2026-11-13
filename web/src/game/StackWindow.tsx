// The stack as a floating window over the table: one tile per spell or ability, top first, with
// its art, kind, rules text and targets. Drag it by its title bar and resize it from the corner;
// both are remembered in this browser. Click a tile, its "⋯" or right-click it for the full text
// and (live games) its auto-yield settings. Lines run from each item to what it targets.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MenuSection } from "../components/CardMenu";
import { cached, imageUrl } from "../scryfall";
import { tokenImage, usePreview } from "./cards";
import type { GameView, StackItemView } from "./view";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const KEY = "cq.stack.box";
const DEFAULT_BOX: Box = { x: 12, y: 12, w: 250, h: 400 };

function loadBox(): Box {
  try {
    const b = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (b && [b.x, b.y, b.w, b.h].every((n) => typeof n === "number")) return b;
  } catch {
    // no storage: the default place
  }
  return DEFAULT_BOX;
}

function art(s: StackItemView): string | undefined {
  if (!s.card || s.card.hidden) return undefined;
  if (s.card.token) return tokenImage(s.card);
  const sc = s.card.name ? cached({ name: s.card.name, quantity: 1, board: "main" }) : undefined;
  return sc && imageUrl(sc, "art_crop");
}

/** Stack positions are numbered from the bottom: 1 resolves last. */
const numberOf = (view: GameView, s: StackItemView) => view.stack.indexOf(s) + 1;

export function StackWindow(props: {
  view: GameView;
  nameOf: (id: string) => string;
  colorOf: (id: string) => string;
  /** Live games: an item's auto-yield settings. */
  itemMenu?: (s: StackItemView) => MenuSection[];
}) {
  const { view, nameOf, colorOf } = props;
  const [box, setBox] = useState<Box>(loadBox);
  const [open, setOpen] = useState<{ id: number; x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const setPreview = usePreview();

  const save = (b: Box) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(b));
    } catch {
      // not remembered
    }
  };

  // Keep it inside the table when the window shrinks.
  useLayoutEffect(() => {
    const parent = ref.current?.offsetParent as HTMLElement | null;
    if (!parent) return;
    const maxX = Math.max(0, parent.clientWidth - 120);
    const maxY = Math.max(0, parent.clientHeight - 60);
    if (box.x > maxX || box.y > maxY) setBox((b) => ({ ...b, x: Math.min(b.x, maxX), y: Math.min(b.y, maxY) }));
  });

  // Remember a resize (CSS `resize`), measured when the pointer is let go.
  const onResizeEnd = () => {
    const el = ref.current;
    if (!el) return;
    const next = { ...box, w: el.offsetWidth, h: el.offsetHeight };
    if (next.w !== box.w || next.h !== box.h) {
      setBox(next);
      save(next);
    }
  };

  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX - box.x;
    const sy = e.clientY - box.y;
    let last = box;
    const move = (ev: PointerEvent) => {
      last = { ...box, x: Math.max(0, ev.clientX - sx), y: Math.max(0, ev.clientY - sy) };
      setBox(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      save(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

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
            const n = numberOf(view, s);
            const targets = s.targets ?? [];
            return (
              <li
                key={s.id}
                className={`stk-item${open?.id === s.id ? " open" : ""}`}
                data-stack-id={s.id}
                style={{ "--seat": colorOf(s.controller) } as React.CSSProperties}
                onClick={(e) => openItem(e, s)}
                onContextMenu={(e) => openItem(e, s)}
                onMouseEnter={() => s.card && setPreview({ card: s.card })}
                onMouseLeave={() => setPreview(null)}
              >
                <span className="stk-num" aria-label={`Stack position ${n}`}>{n}</span>
                <div className="stk-name">{s.name}</div>
                {src ? <img className="stk-art" src={src} alt="" draggable={false} /> : <div className="stk-art none" />}
                <div className="stk-kind">
                  {s.kind}
                  <span> · {s.controller === view.viewer ? "you" : nameOf(s.controller)}</span>
                  {(s.autoYield || (s.decision && s.decision !== "ASK")) && (
                    <b className="stk-flag">{s.autoYield ? "auto-yield" : s.decision === "ACCEPT" ? "always yes" : "always no"}</b>
                  )}
                </div>
                {s.text && <p className="stk-text">{s.text}</p>}
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

/** An item opened from the stack: its settings menu beside the whole ability, targets included. */
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
  return (
    <div ref={ref} className="stk-detail-wrap" style={pos} onContextMenu={(e) => (e.preventDefault(), e.stopPropagation())}>
      {sections.length > 0 && (
        <div className="card-menu stk-menu" role="menu" aria-label={`${item.name} settings`}>
          {sections.map((s, i) => (
            <div key={i} className="card-menu-section">
              {s.title && <div className="card-menu-title">{s.title}</div>}
              {s.items.map((it) => (
                <button key={it.label} role="menuitem" disabled={it.disabled} onClick={() => it.onSelect()}>
                  {it.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <article className="stk-detail" style={{ "--seat": "var(--accent)" } as React.CSSProperties}>
        <header>
          <h4>
            <span className="stk-num inline">{props.number}</span> {item.name}
          </h4>
          <button className="dialog-close" aria-label="Close" onClick={onClose}>×</button>
        </header>
        {props.src && <img className="stk-art" src={props.src} alt="" draggable={false} />}
        <div className="stk-kind">{item.kind}</div>
        <p className="stk-full">{item.text || item.name}</p>
        {item.targets?.length ? <p className="stk-full-targets">Targets: {item.targets.map((t) => t.label).join(", ")}</p> : null}
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
  end: { x: number; y: number };
}

/**
 * Curved lines from each stack tile to the cards and players it targets, numbered like the tile,
 * and a dashed one to the permanent an ability comes from. Positions follow the page every frame
 * while the stack has something on it (boards resize, the window gets dragged).
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
    const tick = () => {
      const v = viewRef.current;
      const next: Line[] = [];
      for (const s of v.stack) {
        const tile = document.querySelector<HTMLElement>(`[data-stack-id="${s.id}"]`);
        if (!tile) continue;
        const from = tile.getBoundingClientRect();
        const n = v.stack.indexOf(s) + 1;
        const color = colorRef.current(s.controller);
        const ends: { el: HTMLElement; dashed: boolean; key: string }[] = [];
        for (const t of s.targets ?? []) {
          const el = t.cardId !== undefined ? findCard(t.cardId) : t.playerId !== undefined ? document.querySelector<HTMLElement>(`[data-player-id="${t.playerId}"]`) : null;
          if (el) ends.push({ el, dashed: false, key: `${t.cardId ?? "p" + t.playerId}` });
        }
        // An ability's source permanent (spells' cards are on the stack itself).
        if (s.card && s.cardId === undefined && s.card.zone === "battlefield") {
          const el = findCard(s.card.id);
          if (el && !ends.some((e) => e.el === el)) ends.push({ el, dashed: true, key: `src${s.card.id}` });
        }
        for (const end of ends) {
          const to = end.el.getBoundingClientRect();
          if (!to.width || overlaps(from, to)) continue;
          const a = { x: from.right - 6, y: from.top + Math.min(40, from.height / 2) };
          const b = { x: to.left + to.width / 2, y: to.top + Math.min(14, to.height / 3) };
          if (b.x < from.left) a.x = from.left + 6; // target to the left of the window
          const mid = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - Math.max(40, Math.abs(b.x - a.x) * 0.25) };
          next.push({ key: `${s.id}-${end.key}`, d: `M${a.x},${a.y} Q${mid.x},${mid.y} ${b.x},${b.y}`, color, dashed: end.dashed, n, end: b });
        }
      }
      const key = next.map((l) => l.key + l.d).join("|");
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
        </g>
      ))}
    </svg>
  );
}

/** A card on the table by id: a battlefield slot (piles list every id), a hand card or a zone tile card. */
function findCard(id: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-card-ids~="${id}"]`);
}

const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
