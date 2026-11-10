// A small dark popup menu of card actions, opened from a "⋯" button. Positioned with `fixed`
// so it isn't clipped by the deck's multi-column layout, and flipped upward near the bottom of
// the window. Closes on outside click, Escape, scroll or resize.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  /** Keep the menu open after choosing (for + / − quantity steps). */
  keepOpen?: boolean;
  disabled?: boolean;
}

export interface MenuSection {
  title?: string;
  items: MenuItem[];
}

export function CardMenu({ label, sections, className = "", trigger }: { label: string; sections: MenuSection[]; className?: string; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return;
    const b = button.current.getBoundingClientRect();
    const m = menu.current.getBoundingClientRect();
    let top = b.bottom + 4;
    if (top + m.height > innerHeight - 8) top = Math.max(8, b.top - m.height - 4);
    const left = Math.min(Math.max(8, b.right - m.width), innerWidth - m.width - 8);
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        className={`menu-btn ${className}${open ? " open" : ""}`}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setPos(null);
          setOpen((o) => !o);
        }}
      >
        {trigger ?? (
          /* Three drawn dots: the "⋯" character sits low in its line box and can't be centered. */
          <span className="dots" aria-hidden="true"><i /><i /><i /></span>
        )}
      </button>
      {open && (
        <div
          ref={menu}
          className="card-menu"
          role="menu"
          style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
        >
          {sections.map((s, i) => (
            <div key={i} className="card-menu-section">
              {s.title && <div className="card-menu-title">{s.title}</div>}
              {s.items.map((item) => (
                <button
                  key={item.label}
                  role="menuitem"
                  className={item.danger ? "danger" : undefined}
                  disabled={item.disabled}
                  onClick={() => {
                    item.onSelect();
                    if (!item.keepOpen) setOpen(false);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
