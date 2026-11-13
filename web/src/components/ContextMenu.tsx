// A right-click menu at the pointer: the same dark popup as CardMenu, opened by `contextmenu`
// instead of a button. Sections can arrive later (e.g. a card's abilities from the game server):
// `loading` shows a placeholder line until then. Closes on outside click, Escape, scroll or resize.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MenuItem, MenuSection } from "./CardMenu";

export interface ContextMenuState {
  x: number;
  y: number;
  title?: string;
  sections: MenuSection[];
  loading?: boolean;
  /** Shown in muted text, e.g. why nothing can be done with the card right now. */
  note?: string;
}

export function ContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Keep it on screen, also as its sections arrive (it grows): flip up near the bottom, and a menu
  // taller than the window scrolls (max-height in CSS).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const m = el.getBoundingClientRect();
      const left = clamp(menu.x, 8, innerWidth - m.width - 8);
      const top = clamp(menu.y + m.height > innerHeight - 8 ? menu.y - m.height : menu.y, 8, innerHeight - m.height - 8);
      setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [menu]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onContext = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    // Scrolling the menu itself (a long one) keeps it open; scrolling the page closes it.
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("contextmenu", onContext, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [menu.loading]);

  return (
    <div
      ref={ref}
      className="card-menu context-menu"
      role="menu"
      aria-label={menu.title}
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.title && <div className="card-menu-title cm-head">{menu.title}</div>}
      {menu.sections.map((s, i) =>
        s.items.length ? (
          <div key={i} className="card-menu-section">
            {s.title && <div className="card-menu-title">{s.title}</div>}
            {s.items.map((item, j) => (
              <Row key={`${j}-${item.label}`} item={item} onClose={onClose} />
            ))}
          </div>
        ) : null,
      )}
      {menu.loading && <div className="cm-note">Checking what this card can do…</div>}
      {menu.note && <div className="cm-note">{menu.note}</div>}
    </div>
  );
}

/** One menu row: a button, optionally with +/− buttons at the end, or a submenu beside it. */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

function Row({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // The submenu is position: fixed, placed beside its row (right, or left when there's no room)
  // and kept inside the window; a long one scrolls.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const row = ref.current?.getBoundingClientRect();
    const p = panel.current?.getBoundingClientRect();
    if (!row || !p) return;
    // Touching the row (no gap), so moving the pointer across doesn't leave the row and close it.
    const left = row.right - 2 + p.width <= innerWidth - 8 ? row.right - 2 : Math.max(8, row.left + 2 - p.width);
    setPos({ left, top: clamp(row.top - 5, 8, innerHeight - p.height - 8) });
  }, [open]);
  if (item.submenu) {
    return (
      <div ref={ref} className="cm-sub" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
        <button role="menuitem" aria-haspopup="menu" aria-expanded={open} disabled={item.disabled} onClick={() => setOpen((o) => !o)}>
          {item.label} <span className="cm-arrow" aria-hidden>▸</span>
        </button>
        {open && (
          <div ref={panel} className="card-menu cm-subpanel" style={pos ?? { top: -9999, left: -9999 }} role="menu" aria-label={item.label}>
            {item.submenu.map((sub, k) => (
              <Row key={`${k}-${sub.label}`} item={sub} onClose={onClose} />
            ))}
          </div>
        )}
      </div>
    );
  }
  const button = (
    <button
      role="menuitem"
      className={item.danger ? "danger" : undefined}
      disabled={item.disabled}
      onClick={() => {
        item.onSelect();
        if (!item.keepOpen) onClose();
      }}
    >
      {item.label}
    </button>
  );
  if (!item.steppers?.length) return button;
  return (
    <div className="cm-steps">
      {button}
      {item.steppers.map((st) => (
        <button key={st.label} className="cm-step" aria-label={st.title} title={st.title} onClick={() => st.onSelect()}>
          {st.label}
        </button>
      ))}
    </div>
  );
}
