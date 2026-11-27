// A deck's changelog (convex/changelog.ts): one entry per sitting of edits. Pure (no Convex imports),
// so `node --test` can run it.

import type { Board, DeckCard } from "./deckRules";

/** An entry takes edits until this long passes without one; the next edit starts a new entry. */
export const CHANGE_GAP_MS = 60 * 60 * 1000;
/** Entries kept per deck; older ones are dropped. */
export const MAX_CHANGE_ENTRIES = 200;

export interface CardDelta {
  name: string;
  board: Board;
  delta: number;
}
export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

const counts = (cards: DeckCard[]) => {
  const m = new Map<string, number>();
  for (const c of cards) m.set(`${c.board}|${c.name}`, (m.get(`${c.board}|${c.name}`) ?? 0) + c.quantity);
  return m;
};

/** Copies added (+) and taken out (-) between two versions of a deck's cards, by board and name. */
export function cardDiff(before: DeckCard[], after: DeckCard[]): CardDelta[] {
  const a = counts(before);
  const b = counts(after);
  const out: CardDelta[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const delta = (b.get(key) ?? 0) - (a.get(key) ?? 0);
    if (!delta) continue;
    const bar = key.indexOf("|");
    out.push({ board: key.slice(0, bar) as Board, name: key.slice(bar + 1), delta });
  }
  return out;
}

/** An entry's card changes with more added in: deltas for the same card add up, and those that cancel out go. */
export function mergeCards(had: CardDelta[], more: CardDelta[]): CardDelta[] {
  const m = new Map(had.map((c) => [`${c.board}|${c.name}`, { ...c }]));
  for (const c of more) {
    const key = `${c.board}|${c.name}`;
    const e = m.get(key);
    if (e) e.delta += c.delta;
    else m.set(key, { ...c });
  }
  return [...m.values()].filter((c) => c.delta !== 0);
}

/** An entry's other changes with more added in: a field keeps where it started, and goes if it's back there. */
export function mergeFields(had: FieldChange[], more: FieldChange[]): FieldChange[] {
  const m = new Map(had.map((f) => [f.field, { ...f }]));
  for (const f of more) {
    const e = m.get(f.field);
    if (e) e.to = f.to;
    else m.set(f.field, { ...f });
  }
  return [...m.values()].filter((f) => f.from !== f.to);
}

export interface Tracked {
  name: string;
  format: string;
  bracket?: number;
}

/** The deck's name, format and bracket changes between two versions. */
export function fieldChanges(before: Tracked, after: Tracked): FieldChange[] {
  const out: FieldChange[] = [];
  if (before.name !== after.name) out.push({ field: "name", from: before.name, to: after.name });
  if (before.format !== after.format) out.push({ field: "format", from: before.format, to: after.format });
  if ((before.bracket ?? 0) !== (after.bracket ?? 0)) out.push({ field: "bracket", from: String(before.bracket ?? ""), to: String(after.bracket ?? "") });
  return out;
}

/** Whether an edit at `now` goes into the entry last edited at `lastAt`. */
export const continues = (lastAt: number, now: number) => now - lastAt < CHANGE_GAP_MS;

/** An entry's card changes for showing: moves (out of one board, into another) together, then adds, then cuts. */
export function describeCards(cards: CardDelta[]): { added: CardDelta[]; removed: CardDelta[]; moved: { name: string; from: Board; to: Board; count: number }[] } {
  const added = cards.filter((c) => c.delta > 0).map((c) => ({ ...c }));
  const removed = cards.filter((c) => c.delta < 0).map((c) => ({ ...c }));
  const moved: { name: string; from: Board; to: Board; count: number }[] = [];
  for (const r of removed) {
    for (const a of added) {
      if (a.name !== r.name || a.delta <= 0 || r.delta >= 0) continue;
      const count = Math.min(a.delta, -r.delta);
      moved.push({ name: r.name, from: r.board, to: a.board, count });
      a.delta -= count;
      r.delta += count;
    }
  }
  return { added: added.filter((c) => c.delta > 0), removed: removed.filter((c) => c.delta < 0), moved };
}
