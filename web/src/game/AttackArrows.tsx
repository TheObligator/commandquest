// Declaring attackers by dragging: press on one of your creatures that can attack and drag an arrow
// to an opponent's board (or their planeswalker / battle) to attack it. If that creature is one of
// several selected cards (marks.tsx), all the selected creatures that can attack go together, one
// arrow each. Drag back onto your own board to call them back. A plain click still does what Forge
// does with it. Once attackers are declared, arrows show who attacks whom for the rest of combat.
import { useEffect, useRef, useState } from "react";
import type { CardView, GameView } from "./view";

/** Who an attack goes to: a player, or a planeswalker or battle (by card id). Null: call them back. */
export type AttackTarget = { player: string } | { card: number } | null;

/** What the pointer is over during a drag, for the boards' highlight. */
export interface AttackHover {
  seat?: string;
  card?: number;
  /** Your own board: dropping calls them back. */
  back?: boolean;
}

interface Drag {
  ids: number[];
  from: { x: number; y: number }[];
  to: { x: number; y: number };
  hover: AttackHover | null;
}

/** Forge's declare-attackers prompt (InputAttack: "Select creatures to attack <defender> or select player/card…"). */
export const isAttackPrompt = (p: { message: string }) => p.message.startsWith("Select creatures to attack");

const isDefenderCard = (c: CardView) => !!c.types?.some((t) => t === "Planeswalker" || t === "Battle");

/** A creature's slot on a battlefield (piles list every id). */
const slotOf = (id: number) => document.querySelector<HTMLElement>(`.battlefield [data-card-ids~="${id}"]`);
const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

export function useAttackDrag(opts: {
  view: GameView;
  /** Your creatures that can attack now; undefined when you're not declaring attackers. */
  candidates?: Set<number>;
  marked: ReadonlySet<number>;
  onDeclare: (ids: number[], to: AttackTarget) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const live = useRef(opts);
  live.current = opts;

  /** What's under the pointer: an opponent's planeswalker or battle, their board, or yours. */
  const hoverAt = (x: number, y: number): AttackHover | null => {
    const { view } = live.current;
    const el = document.elementFromPoint(x, y);
    const board = el?.closest<HTMLElement>(".seat-board[data-seat]");
    const seat = board?.dataset.seat;
    if (!seat) return null;
    if (seat === view.viewer) return { back: true };
    const p = view.players.find((x) => x.id === seat);
    if (!p || p.lost) return null;
    const ids = el?.closest("[data-card-ids]")?.getAttribute("data-card-ids")?.split(" ").map(Number) ?? [];
    const card = p.battlefield.find((c) => ids.includes(c.id) && isDefenderCard(c));
    return card ? { seat, card: card.id } : { seat };
  };

  /** Start a drag from a pile of yours (pointerdown on it). A press that doesn't move stays a click. */
  const begin = (e: React.PointerEvent, pileIds: number[]) => {
    const { candidates, marked } = live.current;
    if (!candidates || e.button !== 0) return;
    const fromSelection = pileIds.some((id) => marked.has(id));
    const ids = (fromSelection ? [...marked] : pileIds).filter((id) => candidates.has(id));
    if (!ids.length) return;
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    let hover: AttackHover | null = null;
    // One arrow per card on the table (a pile is one place, so one arrow).
    const starts = () => {
      const seen = new Set<HTMLElement>();
      const pts: { x: number; y: number }[] = [];
      for (const id of ids) {
        const el = slotOf(id);
        if (el && !seen.has(el)) (seen.add(el), pts.push(center(el.getBoundingClientRect())));
      }
      return pts;
    };
    let from: { x: number; y: number }[] = [];
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (!moved) from = starts();
      moved = true;
      ev.preventDefault();
      hover = hoverAt(ev.clientX, ev.clientY);
      setDrag({ ids, from, to: { x: ev.clientX, y: ev.clientY }, hover });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setDrag(null);
      if (!moved) return; // a click: the card's own click handler does it
      // The click that ends a drag isn't a click on the card.
      const swallow = (ev: MouseEvent) => ev.stopPropagation();
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      if (!hover) return;
      live.current.onDeclare(ids, hover.back ? null : hover.card !== undefined ? { card: hover.card } : { player: hover.seat! });
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  // Esc drops the arrow without attacking.
  useEffect(() => {
    if (!drag) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        window.dispatchEvent(new Event("pointercancel"));
      }
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [drag]);

  const overlay = drag && <DragArrows drag={drag} />;
  return { begin, hover: drag?.hover ?? null, dragging: !!drag, overlay };
}

/** Where an arrow to this target ends: the planeswalker's middle, or the player's name plate. */
function targetPoint(hover: AttackHover): { x: number; y: number } | null {
  const el = hover.card !== undefined
    ? slotOf(hover.card)
    : hover.seat !== undefined ? document.querySelector<HTMLElement>(`.seat-board[data-seat="${hover.seat}"] .sb-name`) : null;
  return el ? center(el.getBoundingClientRect()) : null;
}

const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // Bend to one side by a little of the length, so several arrows to one place fan out.
  const bend = Math.min(60, len * 0.18);
  const mid = { x: (a.x + b.x) / 2 - (dy / len) * bend, y: (a.y + b.y) / 2 + (dx / len) * bend };
  return `M${a.x},${a.y} Q${mid.x},${mid.y} ${b.x},${b.y}`;
};

function DragArrows({ drag }: { drag: Drag }) {
  const snap = drag.hover && !drag.hover.back ? targetPoint(drag.hover) : null;
  const to = snap ?? drag.to;
  const back = !!drag.hover?.back;
  return (
    <svg className={`attack-arrows dragging${back ? " back" : ""}${snap ? " locked" : ""}`} aria-hidden>
      <defs>
        <marker id="atk-head-drag" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" />
        </marker>
      </defs>
      {drag.from.map((a, i) => (
        <g key={i}>
          <path className="aa-glow" d={curve(a, to)} />
          <path className="aa-line" d={curve(a, to)} markerEnd="url(#atk-head-drag)" />
        </g>
      ))}
      {drag.ids.length > 1 && (
        <g transform={`translate(${drag.to.x + 14},${drag.to.y + 18})`}>
          <rect x="-4" y="-11" rx="8" width={back ? 70 : 34} height="16" />
          <text x={back ? 31 : 13} dy="1">{back ? "call back" : `×${drag.ids.length}`}</text>
        </g>
      )}
    </svg>
  );
}

interface Line {
  key: string;
  d: string;
  color: string;
}

/** Arrows from each attacking creature to what it attacks, while attackers are in combat. */
export function CombatArrows({ view, colorOf, hide }: { view: GameView; colorOf: (id: string) => string; hide?: boolean }) {
  const [lines, setLines] = useState<Line[]>([]);
  const viewRef = useRef(view);
  viewRef.current = view;
  const colorRef = useRef(colorOf);
  colorRef.current = colorOf;
  const active = !hide && view.players.some((p) => p.battlefield.some((c) => c.attacking));

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
      const done = new Set<HTMLElement>(); // a pile attacking one place: one arrow
      for (const p of v.players) for (const c of p.battlefield) {
        if (!c.attacking) continue;
        const el = slotOf(c.id);
        if (!el || done.has(el)) continue;
        done.add(el);
        const to = targetPoint(c.attackingCard !== undefined ? { card: c.attackingCard } : { seat: c.attacking });
        if (!to) continue;
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const a = center(r);
        next.push({ key: `${c.id}`, d: curve(a, to), color: colorRef.current(c.controller) });
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

  if (!active || !lines.length) return null;
  return (
    <svg className="attack-arrows" aria-hidden>
      <defs>
        <marker id="atk-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" />
        </marker>
      </defs>
      {lines.map((l) => (
        <g key={l.key} style={{ "--seat": l.color } as React.CSSProperties}>
          <path className="aa-glow" d={l.d} />
          <path className="aa-line" d={l.d} markerEnd="url(#atk-head)" />
        </g>
      ))}
    </svg>
  );
}
