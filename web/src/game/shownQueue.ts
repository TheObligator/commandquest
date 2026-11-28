// The queue of reveal windows (cards shown to you; the game doesn't wait). Reveals made while one
// stack item resolves share a `group` from the server (Ambassador K'Ehleyr: each player reveals the
// top of their library) and go into one window, a section per player.
// Pure logic (no DOM), so node --test can run it.
import type { CardView } from "./view";

/** One player's cards in a reveal window. `note` says why there are none. */
export interface ShownSection {
  owner?: string;
  zone?: string;
  note?: string;
  cards: CardView[];
}

/** One reveal window. `title`: Forge's message, or "<source> — revealed" once it holds several players' cards. */
export interface LiveShown {
  n: number;
  title: string;
  group?: string;
  source?: string;
  sections: ShownSection[];
}

/** A "shown" message from the server. */
export interface ShownMessage {
  title?: string;
  note?: string;
  owner?: string;
  zone?: string;
  group?: string;
  source?: string;
  cards?: CardView[];
}

/** At most this many windows wait; older ones are dropped. */
const MAX = 20;

/** The queue with `m` added: into the waiting window of its group if there is one, else as a new window numbered `n`. */
export function addShown(queue: LiveShown[], m: ShownMessage, n: number): LiveShown[] {
  const cards = m.cards ?? [];
  const at = m.group ? queue.findIndex((s) => s.group === m.group) : -1;
  if (at < 0) {
    const item: LiveShown = { n, title: m.title ?? "", group: m.group, source: m.source, sections: [{ owner: m.owner, zone: m.zone, note: m.note, cards }] };
    return [...queue, item].slice(-MAX);
  }
  const item = queue[at];
  // A card already in the window (you looked at it, then it was revealed to everyone) shows once.
  const seen = new Set(item.sections.flatMap((s) => s.cards.map((c) => c.id)));
  const fresh = cards.filter((c) => !seen.has(c.id));
  const sections = [...item.sections];
  const i = sections.findIndex((s) => s.owner !== undefined && s.owner === m.owner);
  if (i >= 0) {
    const s = sections[i];
    const merged = [...s.cards, ...fresh];
    sections[i] = { ...s, cards: merged, note: merged.length ? undefined : s.note ?? m.note };
  } else if (fresh.length || !cards.length) {
    sections.push({ owner: m.owner, zone: m.zone, note: m.note, cards: fresh });
  }
  const title = sections.length > 1 && item.source ? `${item.source} — revealed` : item.title;
  const next = [...queue];
  next[at] = { ...item, title, sections };
  return next;
}
