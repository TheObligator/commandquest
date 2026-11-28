// Lines from a panel to the cards it talks about: hovering Forge's decision ("Use triggered ability
// of Bilbo?") points at Bilbo on the table. Drawn like the stack's target arrows.
import { useEffect, useState } from "react";
import { AwayLabel } from "./StackWindow";
import { findCardEl, type Spot, spotOf } from "./locate";

interface Line {
  key: string;
  d: string;
  end: Spot;
}

/** Curved lines from `from` to each card in `ids` that's on the table, following them every frame. */
export function PointArrows({ from, ids, color }: { from: HTMLElement | null; ids: number[]; color: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const key = ids.join(",");

  useEffect(() => {
    if (!from || !ids.length) {
      setLines([]);
      return;
    }
    let raf = 0;
    let lastKey = "";
    const tick = () => {
      const box = from.getBoundingClientRect();
      const next: Line[] = [];
      for (const id of ids) {
        const el = findCardEl(id);
        if (!el || from.contains(el)) continue;
        const b = spotOf(el, (to) => ({ x: to.left + to.width / 2, y: to.top + Math.min(14, to.height / 3) }), el.querySelector("img")?.alt || undefined);
        if (!b) continue;
        const a = { x: box.right - 4, y: box.top + Math.min(30, box.height / 2) };
        if (b.x < box.left) a.x = box.left + 4;
        const mid = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - Math.max(40, Math.abs(b.x - a.x) * 0.25) };
        next.push({ key: String(id), d: `M${a.x},${a.y} Q${mid.x},${mid.y} ${b.x},${b.y}`, end: b });
      }
      const k = next.map((l) => l.key + l.d + (l.end.away ?? "")).join("|");
      if (k !== lastKey) {
        lastKey = k;
        setLines(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lines.length) return null;
  return (
    <svg className="stack-arrows point-arrows" aria-hidden style={{ "--seat": color } as React.CSSProperties}>
      {lines.map((l) => (
        <g key={l.key}>
          <path className="sa-glow" d={l.d} />
          <path className="sa-line" d={l.d} />
          <circle cx={l.end.x} cy={l.end.y} r="6" />
          {l.end.away && <AwayLabel spot={l.end} />}
        </g>
      ))}
    </svg>
  );
}
