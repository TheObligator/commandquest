// A window that floats over the table: drag it by a handle, resize it from its bottom-right
// corner (CSS `resize: both`). Its place and size are remembered in this browser under `key`.
// Used by the stack window and the revealed-cards window.
import { useLayoutEffect, useRef, useState } from "react";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function loadBox(key: string, fallback: () => Box): Box {
  try {
    const b = JSON.parse(localStorage.getItem(key) ?? "null");
    if (b && [b.x, b.y, b.w, b.h].every((n) => typeof n === "number")) return b;
  } catch {
    // no storage: the default place
  }
  return fallback();
}

function saveBox(key: string, b: Box) {
  try {
    localStorage.setItem(key, JSON.stringify(b));
  } catch {
    // not remembered
  }
}

/**
 * `ref` goes on the window, `startDrag` on its drag handle's onPointerDown, `onResizeEnd` on the
 * window's onPointerUp, and `box` sets its left/top/width/height. The window is placed in its
 * offset parent, or in the viewport when it's `position: fixed`.
 */
export function useFloatingBox(key: string, fallback: () => Box) {
  const [box, setBox] = useState<Box>(() => loadBox(key, fallback));
  const ref = useRef<HTMLDivElement>(null);

  // Keep it on screen when the table (or the browser window) shrinks.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parent = el.offsetParent as HTMLElement | null;
    const pw = parent ? parent.clientWidth : window.innerWidth;
    const ph = parent ? parent.clientHeight : window.innerHeight;
    const maxX = Math.max(0, pw - 120);
    const maxY = Math.max(0, ph - 60);
    if (box.x > maxX || box.y > maxY) setBox((b) => ({ ...b, x: Math.min(b.x, maxX), y: Math.min(b.y, maxY) }));
  });

  // Remember a resize, measured when the pointer is let go.
  const onResizeEnd = () => {
    const el = ref.current;
    if (!el) return;
    const next = { ...box, w: el.offsetWidth, h: el.offsetHeight };
    if (next.w !== box.w || next.h !== box.h) {
      setBox(next);
      saveBox(key, next);
    }
  };

  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
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
      saveBox(key, last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return { box, ref, startDrag, onResizeEnd };
}
