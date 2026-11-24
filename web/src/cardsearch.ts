// Card-name search in the browser, forgiving of typos, with no requests while typing. The names come
// from /card-names.json, which scripts/cardnames.ts builds from Scryfall's daily bulk data; this runs
// in a Web Worker (cardsearch.worker.ts), started by localsearch.ts.
//
// Pure logic with no DOM or browser APIs, so `node --test` can run it.

import type { RulesCard } from "./formats/conquest";

/** /card-names.json. Cards are in EDHREC popularity order; the columns line up by position. */
export interface CardNamesData {
  names: string[];
  /** Color identity, one base-32 digit per card: the sum of W 1, U 2, B 4, R 8, G 16. */
  identity: string;
  /** Distinct front-face type lines, and each card's. */
  types: string[];
  type: number[];
  /** Front-face power of 4 or more, and mana value of 7 or more (what Rulebreakers ask about). */
  power: Record<number, number>;
  mv: Record<number, number>;
  /** Cards with hybrid mana symbols: every mana symbol on them, reminder text aside. */
  hybrid: Record<number, string>;
  /** Color indicators of those cards. */
  indicator: Record<number, string>;
}

const COLORS = "WUBRG";
const MIN_POWER = 4;
const MIN_MV = 7;

// ---- Building and reading the data -----------------------------------------------------------

/** The fields of a bulk-data card that {@link buildCardNames} reads. */
export interface BulkCard {
  name: string;
  layout: string;
  cmc?: number;
  mana_cost?: string;
  oracle_text?: string;
  type_line?: string;
  power?: string;
  color_identity: string[];
  color_indicator?: string[];
  edhrec_rank?: number;
  card_faces?: { type_line?: string; mana_cost?: string; oracle_text?: string; power?: string; color_indicator?: string[] }[];
}

/** Things Scryfall has that aren't cards for a deck. */
const NOT_CARDS = new Set(["token", "double_faced_token", "art_series", "emblem", "planar", "scheme", "vanguard"]);

export function buildCardNames(cards: Iterable<BulkCard>): CardNamesData {
  const byName = new Map<string, BulkCard>();
  for (const c of cards) {
    if (NOT_CARDS.has(c.layout) || c.name.startsWith("A-") || /^(.+) \/\/ \1$/.test(c.name)) continue; // "A-": Alchemy rebalances
    const prev = byName.get(c.name);
    if (!prev || (c.edhrec_rank ?? Infinity) < (prev.edhrec_rank ?? Infinity)) byName.set(c.name, c);
  }
  const list = [...byName.values()].sort((a, z) => (a.edhrec_rank ?? 1e9) - (z.edhrec_rank ?? 1e9) || (a.name < z.name ? -1 : 1));
  const types = new Map<string, number>();
  const data: CardNamesData = { names: [], identity: "", types: [], type: [], power: {}, mv: {}, hybrid: {}, indicator: {} };
  list.forEach((c, i) => {
    const faces = c.card_faces?.length ? c.card_faces : [c];
    data.names.push(c.name);
    data.identity += c.color_identity.reduce((n, x) => n + (1 << COLORS.indexOf(x)), 0).toString(32);
    const type = faces[0].type_line ?? (c.type_line ?? "").split(" // ")[0];
    if (!types.has(type)) types.set(type, types.size);
    data.type.push(types.get(type)!);
    const power = parseInt(faces[0].power ?? c.power ?? "", 10) || 0;
    if (power >= MIN_POWER) data.power[i] = power;
    if ((c.cmc ?? 0) >= MIN_MV) data.mv[i] = c.cmc!;
    const symbols = faces.flatMap((f) => `${f.mana_cost ?? ""} ${(f.oracle_text ?? "").replace(/\([^)]*\)/g, "")}`.match(/\{[^}]+\}/g) ?? []).filter((s) => /[WUBRG]/.test(s));
    if (symbols.some((s) => /\/[^P]/.test(s))) {
      data.hybrid[i] = [...new Set(symbols)].join("");
      const indicator = [c, ...faces].flatMap((f) => f.color_indicator ?? []).join("");
      if (indicator) data.indicator[i] = indicator;
    }
  });
  data.types = [...types.keys()];
  return data;
}

/** The card at a position, with as much as the color identity rules (formats/) need. */
export function cardAt(data: CardNamesData, i: number): RulesCard & { power?: string; cmc?: number } {
  const bits = parseInt(data.identity[i], 32);
  return {
    name: data.names[i],
    layout: "normal",
    type_line: data.types[data.type[i]],
    mana_cost: data.hybrid[i],
    color_indicator: data.indicator[i]?.split(""),
    color_identity: COLORS.split("").filter((_, n) => bits & (1 << n)),
    legalities: {},
    power: data.power[i]?.toString(),
    cmc: data.mv[i],
  };
}

/** What limits a deck's cards: plain data, so it can be sent to the worker. */
export interface IdentityRules {
  commanders: RulesCard[];
  conquest: boolean;
  extraColor?: string;
}

/** Commander's color identity rule (Conquest's is `fitsIdentity`). */
export const plainFits = (card: { color_identity: string[] }, id: Set<string>) => card.color_identity.every((x) => id.has(x));

// ---- Searching -------------------------------------------------------------------------------

/** Lowercase, accents and punctuation dropped, other characters as single spaces. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/['‘’",.!?:]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface NameResults {
  names: string[];
  /** `match`: the text as typed is in these names. `guess`: nothing has it; these are spelled closest. */
  kind: "match" | "guess" | "none";
  /** Some name has the text as typed, even if only of a card `allowed` leaves out. */
  known: boolean;
}

const MAX_GUESSES = 5;
/** Longer text than this is no card name: cut it, so a pasted paragraph costs nothing. */
const MAX_TEXT = 80;

export class CardSearch {
  private readonly folded: string[];
  /** Distinct words over all names, and which names have each. */
  private readonly words: string[];
  private readonly withWord: number[][];
  /** Letter triples (names without their spaces), and which names have each. */
  private readonly withGram = new Map<string, number[]>();
  private readonly gramCount: Uint8Array;

  private readonly names: string[];

  constructor(names: string[]) {
    this.names = names;
    this.folded = names.map(fold);
    const words = new Map<string, number[]>();
    this.gramCount = new Uint8Array(names.length);
    const add = (map: Map<string, number[]>, key: string, i: number) => {
      const at = map.get(key);
      if (at) at.push(i);
      else map.set(key, [i]);
    };
    this.folded.forEach((f, i) => {
      for (const w of new Set(f.split(" "))) add(words, w, i);
      const grams = gramsOf(f);
      this.gramCount[i] = Math.min(255, grams.size);
      for (const g of grams) add(this.withGram, g, i);
    });
    this.words = [...words.keys()];
    this.withWord = [...words.values()];
  }

  /** Names for what's typed so far, best first. `allowed` (by position) limits which cards count. */
  search(text: string, limit = 8, allowed?: Uint8Array): NameResults {
    const q = fold(text.slice(0, MAX_TEXT));
    if (!q) return { names: [], kind: "none", known: false };
    const { hits, known, inside } = this.literal(q, limit, allowed);
    if (hits.length && (!inside || q.length < 5)) return { names: hits.map((i) => this.names[i]), kind: "match", known };
    const guesses = q.length < 3 ? [] : this.guess(q, Math.min(limit, MAX_GUESSES), allowed);
    // Only inside other words, so it may well be a typo ("giled sentinel" is in Sigiled Sentinel): show both.
    if (hits.length) {
      const some = [...hits.slice(0, Math.max(1, limit - MAX_GUESSES)), ...guesses, ...hits];
      return { names: [...new Set(some)].slice(0, limit).map((i) => this.names[i]), kind: "match", known };
    }
    return { names: guesses.map((i) => this.names[i]), kind: guesses.length ? "guess" : "none", known };
  }

  /**
   * Names with the text in them. In order: the whole name (or a face of it); names starting with it,
   * or with it as a whole word ("bolt" in Lightning Bolt); a later word or face starting with it; all
   * its words in any order ("path exile"); inside a word (`inside`: there are only these). Cards are
   * stored most popular first, so each group is too.
   */
  private literal(q: string, limit: number, allowed?: Uint8Array): { hits: number[]; known: boolean; inside: boolean } {
    const groups: number[][] = [[], [], [], [], []];
    const parts = q.split(" ").map((w) => ` ${w}`);
    const bare = q.replaceAll(" ", "");
    let known = false;
    for (let i = 0; i < this.folded.length; i++) {
      const f = this.folded[i];
      let group: number;
      const at = f.indexOf(q);
      if (at === 0) group = f === q || this.isFace(i, q) ? 0 : 1;
      else if (at > 0) group = !` ${f}`.includes(` ${q}`) ? 4 : this.isFace(i, q) ? 0 : q.length >= 3 && ` ${f} `.includes(` ${q} `) ? 1 : 2;
      else if (parts.length > 1 && hasWords(` ${f}`, parts)) group = 3;
      // Spaces left out: "swordstoplow". Only tried from the same first letter, as it's slower.
      else if (bare.length >= 5 && f[0] === bare[0] && f[1] === bare[1] && f.replaceAll(" ", "").startsWith(bare)) group = 3;
      else continue;
      known = true;
      if (allowed && !allowed[i]) continue;
      if (groups[group].length < limit) groups[group].push(i);
    }
    return { hits: groups.flat().slice(0, limit), known, inside: groups.slice(0, 4).every((g) => !g.length) };
  }

  private isFace(i: number, q: string): boolean {
    const n = this.names[i];
    return n.includes(" // ") && n.split(" // ").some((face) => fold(face) === q);
  }

  /** Names spelled like the text: every typed word close to a word of the name, else shared letter triples. */
  private guess(q: string, limit: number, allowed?: Uint8Array): number[] {
    const n = this.names.length;
    const typed = q.split(" ");
    const score = new Float32Array(n);
    const matched = new Uint8Array(n);
    const best = new Float32Array(n);
    typed.forEach((t, k) => {
      const max = t.length < 3 ? 0 : t.length < 6 ? 1 : 2;
      best.fill(99);
      for (let w = 0; w < this.words.length; w++) {
        const d = wordDistance(t, this.words[w], max);
        if (d < 99) for (const i of this.withWord[w]) if (d < best[i]) best[i] = d;
      }
      for (let i = 0; i < n; i++) {
        if (best[i] < 99 && matched[i] === k) {
          matched[i]++;
          score[i] += best[i];
        }
      }
    });
    const hits: [score: number, at: number][] = [];
    for (let i = 0; i < n; i++) {
      if (matched[i] !== typed.length || (allowed && !allowed[i])) continue;
      // Equally close: the more popular card, the name the text covers more of, the same number of words.
      const rest = Math.min(0.5, Math.abs(this.folded[i].length - q.length) / 60);
      hits.push([score[i] + (0.4 * i) / n + rest - (this.folded[i].split(" ").length === typed.length ? 0.3 : 0), i]);
    }
    if (hits.length < limit) {
      const have = new Set(hits.map((h) => h[1]));
      const grams = gramsOf(q);
      const shared = new Uint8Array(n);
      for (const g of grams) for (const i of this.withGram.get(g) ?? []) shared[i]++;
      const loose: [number, number][] = [];
      let top = 0;
      for (let i = 0; i < n; i++) {
        if (shared[i] < 2 || have.has(i) || (allowed && !allowed[i])) continue;
        // Like the whole name, or (a bit less) like a part of it.
        const alike = Math.max((2 * shared[i]) / (grams.size + this.gramCount[i]), (0.8 * shared[i]) / grams.size);
        if (alike < 0.35) continue;
        top = Math.max(top, alike);
        loose.push([alike, i]);
      }
      // After every word-by-word match, and only the ones about as close as the closest.
      for (const [alike, i] of loose) if (alike >= top * 0.8) hits.push([100 - alike + (0.02 * i) / n, i]);
    }
    return hits
      .sort((a, z) => a[0] - z[0])
      .slice(0, limit)
      .map((h) => h[1]);
  }
}

function hasWords(name: string, parts: string[]): boolean {
  for (const p of parts) if (!name.includes(p)) return false;
  return true;
}

function gramsOf(folded: string): Set<string> {
  const s = `  ${folded.replaceAll(" ", "")}`;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

const ROWS = [new Uint8Array(MAX_TEXT * 2), new Uint8Array(MAX_TEXT * 2), new Uint8Array(MAX_TEXT * 2)];

/**
 * Edits (a swap of neighbours is one) from `typed` to `word` or the start of it, where a start costs
 * a quarter more; 99 when it's more than `max`.
 */
export function wordDistance(typed: string, word: string, max: number): number {
  const n = typed.length;
  const m = Math.min(word.length, n + max);
  if (n - word.length > max) return 99;
  let [a, b, c] = ROWS;
  for (let j = 0; j <= m; j++) b[j] = j;
  for (let i = 1; i <= n; i++) {
    c[0] = i;
    let low = i;
    for (let j = 1; j <= m; j++) {
      let v = Math.min(b[j] + 1, c[j - 1] + 1, b[j - 1] + (typed[i - 1] === word[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && typed[i - 1] === word[j - 2] && typed[i - 2] === word[j - 1]) v = Math.min(v, a[j - 2] + 1);
      c[j] = v;
      if (v < low) low = v;
    }
    if (low > max) return 99;
    [a, b, c] = [b, c, a];
  }
  let best = 99;
  for (let j = 0; j <= m; j++) if (b[j] < best) best = b[j];
  if (best > max) return 99;
  return m === word.length && b[m] === best ? best : best + 0.25;
}
