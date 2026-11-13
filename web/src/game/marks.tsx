// Selecting several cards at once, to do the same thing to all of them from one right-click menu
// (tap your lands, put +1/+1 counters on your creatures, exile a graveyard…).
// Drag a box over empty board space (or in a card viewer) to select the cards it touches, or
// Shift/Ctrl/⌘-click cards to add or take them out. Esc or a click on empty space clears it.
import { createContext, useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface Marks {
  marked: ReadonlySet<number>;
  /** Adds the cards, or takes them all out if they're all selected already. */
  toggle: (ids: number[]) => void;
  /** Replaces the selection. */
  set: (ids: Iterable<number>) => void;
}

export const MarkContext = createContext<Marks>({ marked: new Set(), toggle: () => {}, set: () => {} });
export const useMarks = () => useContext(MarkContext);

/** Shift, Ctrl or ⌘ held: the click selects the card instead of using it. */
export const isMarkClick = (e: React.MouseEvent) => e.shiftKey || e.ctrlKey || e.metaKey;

/** The card ids under an element ("12 13" on a pile). */
export const idsOf = (el: Element) => (el.getAttribute("data-card-ids") ?? "").split(" ").filter(Boolean).map(Number);

/**
 * Drag-to-select in a container: returns its mousedown handler and the box to render while
 * dragging. A drag that starts on a card or a control isn't a selection (it moves the card).
 */
export function useMarquee() {
  const { marked, set } = useMarks();
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const live = useRef(marked);
  live.current = marked;

  const onMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as Element).closest("[data-card-ids], button, a, input, select, textarea, label")) return;
    const container = e.currentTarget;
    const add = isMarkClick(e);
    const base = add ? new Set(live.current) : new Set<number>();
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const move = (ev: MouseEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      moved = true;
      ev.preventDefault();
      const r = { left: Math.min(x0, ev.clientX), top: Math.min(y0, ev.clientY), right: Math.max(x0, ev.clientX), bottom: Math.max(y0, ev.clientY) };
      setBox({ x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top });
      const hit = new Set(base);
      for (const el of container.querySelectorAll("[data-card-ids]")) {
        const b = el.getBoundingClientRect();
        if (b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom) idsOf(el).forEach((id) => hit.add(id));
      }
      set(hit);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setBox(null);
      if (!moved && !add && live.current.size) set([]); // a plain click on empty space clears it
      if (moved) {
        // The click that ends a drag isn't a click: it mustn't close a card viewer it ended outside of.
        const swallow = (ev: MouseEvent) => ev.stopPropagation();
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // In the top layer (inside an open dialog) when there is one, so it shows over a card viewer.
  const marquee = box && createPortal(
    <div className="marquee" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} aria-hidden />,
    document.querySelector("dialog[open]") ?? document.body,
  );
  return { onMouseDown, marquee };
}
