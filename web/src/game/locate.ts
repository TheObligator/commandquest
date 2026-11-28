// Where arrows end. The table can have one board enlarged over it (`.focus-overlay`), which renders
// that board a second time on top. Arrows then go to the enlarged copy of a card, and a card that's
// only on the covered table (another player's board) gets an arrow to the overlay's edge, toward
// where it is, with a label saying whose board it's on.

export interface Point {
  x: number;
  y: number;
}

/** Where an arrow ends. `away`: the thing is under the enlarged board, and this says where it is. */
export interface Spot extends Point {
  rect: DOMRect;
  away?: string;
}

const overlayEl = () => document.querySelector<HTMLElement>(".focus-overlay");

export const center = (r: DOMRect): Point => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** The first element matching `selector`, preferring one on the enlarged board. */
export function findEl(selector: string): HTMLElement | null {
  return overlayEl()?.querySelector<HTMLElement>(selector) ?? document.querySelector<HTMLElement>(selector);
}

/** A card on the table by id: a battlefield slot (piles list every id), a hand card or a zone tile card. */
export const findCardEl = (id: number) => findEl(`[data-card-ids~="${id}"]`);

/** A player's name plate. */
export const findPlayerEl = (id: string) => findEl(`[data-player-id="${CSS.escape(id)}"]`);

/** Whose board an element is on, for a label: "Ann's board", "your board". */
function boardOf(el: HTMLElement): string | undefined {
  const name = el.closest(".seat-board")?.querySelector(".sb-name")?.textContent?.trim();
  if (!name) return undefined;
  return name.endsWith(" (you)") ? "your board" : `${name}'s board`;
}

/**
 * Where an arrow to `el` ends: `at` picks the point on its box. Null when it isn't laid out. Under
 * the enlarged board: a point just inside the overlay's edge, on the line from the overlay's middle
 * toward where it really is, with `away` naming it and whose board it's on.
 */
export function spotOf(el: HTMLElement, at: (r: DOMRect) => Point = center, name?: string): Spot | null {
  const r = el.getBoundingClientRect();
  if (!r.width) return null;
  const ov = overlayEl();
  if (!ov || ov.contains(el)) return { ...at(r), rect: r };
  const o = ov.getBoundingClientRect();
  const m = center(o);
  const c = center(r);
  let dx = c.x - m.x;
  let dy = c.y - m.y;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = -1;
  const inset = 26;
  const s = Math.min((o.width / 2 - inset) / Math.max(Math.abs(dx), 1e-6), (o.height / 2 - inset) / Math.max(Math.abs(dy), 1e-6));
  const p = { x: m.x + dx * s, y: m.y + dy * s };
  const board = boardOf(el);
  const away = [name, board ? `on ${board}` : "not on this board"].filter(Boolean).join(" · ");
  return { ...p, rect: new DOMRect(p.x, p.y, 0, 0), away };
}

/** A label box for an `away` spot, kept on the overlay's inner side of the point. */
export function awayLabel(p: Spot): { x: number; y: number; w: number } {
  const w = Math.round((p.away?.length ?? 0) * 6.4 + 16);
  const ov = overlayEl()?.getBoundingClientRect();
  const m = ov ? center(ov) : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const x = p.x > m.x ? p.x - 16 - w : p.x + 16;
  const y = p.y > m.y ? p.y - 30 : p.y + 14;
  return { x, y, w };
}
