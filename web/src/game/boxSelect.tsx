// Drag-selecting: press on an empty part of an area and drag to draw a box; every card the box
// touches is selected. Cards mark themselves with `data-sel` (one id, or several space-separated
// for a pile). A click on empty space (no drag) clears the selection.
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Box { x0: number; y0: number; x1: number; y1: number }

/** Below this many pixels of movement, a press is a click, not a box. */
const SLOP = 4;

export function useBoxSelect(onSelect: (ids: number[], additive: boolean) => void) {
  const [box, setBox] = useState<Box | null>(null);
  const area = useRef<HTMLElement | null>(null);

  const hits = (b: Box) => {
    const left = Math.min(b.x0, b.x1), right = Math.max(b.x0, b.x1);
    const top = Math.min(b.y0, b.y1), bottom = Math.max(b.y0, b.y1);
    const ids: number[] = [];
    area.current?.querySelectorAll<HTMLElement>("[data-sel]").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right >= left && r.left <= right && r.bottom >= top && r.top <= bottom) {
        for (const s of (el.dataset.sel ?? "").split(" ")) if (s) ids.push(Number(s));
      }
    });
    return ids;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || e.pointerType === "touch") return;
    const target = e.target as Element;
    // On a card or a control, the press is theirs (drag, click).
    if (target.closest("[data-sel], button, input, a, [draggable=true]")) return;
    area.current = e.currentTarget;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const start: Box = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
    let moved = false;
    const move = (ev: PointerEvent) => {
      const b = { ...start, x1: ev.clientX, y1: ev.clientY };
      if (!moved && Math.abs(b.x1 - b.x0) < SLOP && Math.abs(b.y1 - b.y0) < SLOP) return;
      moved = true;
      ev.preventDefault(); // no text selection while drawing
      setBox(b);
      onSelect(hits(b), additive);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setBox(null);
      if (!moved && !additive) onSelect([], false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // In a portal, so a transformed or blurred ancestor can't shift the fixed-position box: into
  // the open dialog when there is one (the page under a modal dialog is hidden by it).
  const overlay = box && area.current && createPortal(
    <div
      className="select-box"
      aria-hidden
      style={{
        left: Math.min(box.x0, box.x1),
        top: Math.min(box.y0, box.y1),
        width: Math.abs(box.x1 - box.x0),
        height: Math.abs(box.y1 - box.y0),
      }}
    />,
    area.current.closest("dialog") ?? document.body,
  );
  return { onPointerDown, overlay };
}

/**
 * The selection a box gives: with `additive` (Shift / Ctrl / ⌘ held), added to what was selected
 * when the box started (`base`); otherwise just the box's cards.
 */
export function boxSelection(base: Set<number>, ids: number[], additive: boolean): Set<number> {
  return new Set(additive ? [...base, ...ids] : ids);
}
