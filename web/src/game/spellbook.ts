// Combos from Commander Spellbook (commanderspellbook.com), looked up per deck and stored with it
// (convex/combos.ts, docs/combos.md). Pure: no React, DOM or Convex here.

export interface SpellbookCard {
  name: string;
  /** Where it can be when the combo starts: H hand, B battlefield, C command zone, E exile, G graveyard, L library. */
  zones: string;
  quantity?: number;
  /** It has to be your commander. */
  commander?: boolean;
}

/** A combo whose cards are all in the deck. */
export interface SpellbookCombo {
  id: string;
  cards: SpellbookCard[];
  /** Cards it needs that aren't named ("Permanent Castable for {C}"). */
  needs: string[];
  /** What it makes ("Infinite colorless mana"). */
  results: string[];
  /** Mana you need to start. */
  mana?: string;
  /** What else has to be true first. */
  before?: string;
  steps: string[];
}

/** A combo the deck has all but one card of. */
export interface NearCombo {
  id: string;
  cards: string[];
  missing: string;
  results: string[];
}

export interface DeckCombos {
  /** The deck it was looked up for ({@link deckKey}). */
  key: string;
  combos: SpellbookCombo[];
  near: NearCombo[];
}

export const comboUrl = (id: string) => `https://commanderspellbook.com/combo/${encodeURIComponent(id)}/`;

/** A card's name to compare by: its front face, in any case. */
export const faceName = (name: string) => name.split(" // ")[0].trim().toLowerCase();

type Entry = { name: string; quantity: number; board: string };

/** The cards that count: the main deck and commanders. */
export function played(cards: Entry[]): { commanders: Entry[]; main: Entry[] } {
  return { commanders: cards.filter((c) => c.board === "commander"), main: cards.filter((c) => c.board === "main") };
}

/** Changes whenever the deck's combos could: which cards it plays and which are commanders. */
export function deckKey(cards: Entry[]): string {
  const { commanders, main } = played(cards);
  const text = [...commanders.map((c) => `*${c.name}`), ...main.map((c) => `${c.quantity > 1 ? `${c.quantity} ` : ""}${c.name}`)].sort().join("\n");
  // FNV-1a, twice with different starts: short, and the same here and on Convex.
  const hash = (h: number) => {
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  return hash(0x811c9dc5) + hash(0x1234567);
}

// ---- in a game ----

export interface ZoneCard {
  name?: string;
  commander?: boolean;
}

/** Your cards by zone letter (the library isn't visible). `B`: what you control. */
export type MyZones = Record<"H" | "B" | "C" | "E" | "G", ZoneCard[]>;

/** Does this combo have all its named cards where they need to be? Unnamed ones (`needs`) can't be told. */
export function isReady(combo: SpellbookCombo, mine: MyZones): boolean {
  const used = new Set<ZoneCard>();
  return combo.cards.every((c) => {
    const name = faceName(c.name);
    const same = (x: ZoneCard) => !!x.name && faceName(x.name) === name && (!c.commander || !!x.commander) && !used.has(x);
    for (let n = 0; n < (c.quantity ?? 1); n++) {
      let found: ZoneCard | undefined;
      for (const z of c.zones) found ??= mine[z as keyof MyZones]?.find(same);
      if (found) used.add(found);
      // In the library, if it's nowhere we can see.
      else if (!c.zones.includes("L") || Object.values(mine).some((zone) => zone.some(same))) return false;
    }
    return true;
  });
}

/** "Basalt Monolith + Rings of Brighthearth" */
export const comboCards = (c: { cards: (SpellbookCard | string)[]; needs?: string[] }) =>
  [...c.cards.map((x) => (typeof x === "string" ? x : `${(x.quantity ?? 1) > 1 ? `${x.quantity} ` : ""}${x.name.split(" // ")[0]}`)), ...(c.needs ?? []).map((n) => n.charAt(0).toLowerCase() + n.slice(1))].join(" + ");

/** "Infinite colorless mana, Infinite storm count +2 more" */
export const resultsText = (results: string[], most = 2) =>
  results.slice(0, most).join(", ") + (results.length > most ? ` +${results.length - most} more` : "");

// ---- recording one with its steps as a guide ----

const RESOLVES = /^(resolve|when|whenever)\b|\btriggers?\b/i;

/** The steps to follow: without "Repeat." and remarks after it. */
export function guideSteps(steps: string[]): string[] {
  const at = steps.findIndex((s) => /^repeat\b(?!.* additional)/i.test(s));
  return at < 0 ? steps : steps.slice(0, at);
}

/**
 * Which of the steps have been done, going by what's been recorded (the recording's own words, "Basalt
 * Monolith: Add {C}", "Pass priority"…). A guess, in order: steps are sentences, and you can tick them yourself.
 */
export function guideProgress(steps: string[], recorded: string[], cards: string[]): number {
  let next = 0;
  const mentions = (step: string, card: string) => {
    const s = step.toLowerCase();
    const name = faceName(card);
    return s.includes(name) || (name.includes(",") && s.includes(name.split(",")[0]));
  };
  for (const r of recorded) {
    if (next >= steps.length) break;
    if (r === "Pass priority") {
      if (RESOLVES.test(steps[next])) next++;
      continue;
    }
    if (r === "Tap for mana") {
      if (/\badd(ing|s)?\b|\bmana\b/i.test(steps[next])) next++;
      continue;
    }
    const card = cards.find((c) => r.toLowerCase().startsWith(`${faceName(c)}:`) || r.toLowerCase() === `use ${faceName(c)}`);
    if (!card) continue;
    for (let i = next; i < steps.length; i++) {
      if (!RESOLVES.test(steps[i]) && mentions(steps[i], card)) {
        next = i + 1;
        break;
      }
    }
  }
  return next;
}

/** Whether what one time round changed (`gains`) shows this result; null when it can't be told from that. */
export function showsResult(result: string, gains: string[]): boolean | null {
  const r = result.toLowerCase();
  const any = (re: RegExp) => gains.some((g) => re.test(g));
  if (/trigger|storm|untap|etb|ltb|win the game|turn|combat|sacrifice|loot|cast/.test(r)) return null;
  if (/\bmana\b/.test(r)) return any(/^\+\d+ \{[WUBRGC]\}$/);
  if (/lifegain|gain life/.test(r)) return any(/^\+\d+ life$/);
  if (/lifeloss|damage/.test(r)) return any(/: −\d+ life$/);
  if (/self-mill|card draw/.test(r)) return any(/^−\d+ card in library$/);
  if (/\bmill\b/.test(r)) return any(/: −\d+ card in library$/);
  if (/token/.test(r)) return any(/^\+\d+ .*token/i);
  if (/counter/.test(r)) return any(/^\+\d+ .*counter/i);
  return null;
}
